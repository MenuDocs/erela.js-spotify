import { Manager, Plugin, TrackUtils } from "erela.js";
import { LoadType, TrackData } from "erela.js/structures/Utils";
import { Query, SearchResult } from "erela.js/structures/Manager";
import { Track } from "erela.js/structures/Player";
import Axios from "axios";

const TEMPLATE = [ "clientID", "clientSecret" ];
const BASE_URL = "https://api.spotify.com/v1";
const REGEX = /https:\/\/open\.spotify\.com\/(.+)\/([A-Za-z0-9]+)/;

const buildSearch = (loadType: LoadType, tracks: Track[], error: string, name: string): SearchResult => ({
    loadType: loadType,
    tracks: tracks ?? [],
    playlist: name ? {
        name,
        duration: tracks.map(track => track.duration)
            .reduce((acc: number, cur: number) => acc + cur, 0)
    } : undefined,
    exception: {
        message: error,
        severity: "COMMON"
    },
});

export class Spotify extends Plugin {
    private clientID: string;
    private clientSecret: string;
    private readonly authorization: string;
    private token: string;
    private readonly options: { headers: { Authorization: string; "Content-Type": string } };
    private _search: (query: string | Query, requester?: unknown) => Promise<SearchResult>;
    private manager: Manager;
    private functions: Record<string, Function>;

    public constructor(options: SpotifyOptions) {
        if (!options || !TEMPLATE.every(t => t in options && typeof options[t] === "string"))
            throw new RangeError('"options" is not an object or does not contain properties "clientID" and "clientSecret" of type "string".');

        super();

        this.clientID = options.clientID;
        this.clientSecret = options.clientSecret;
        this.authorization = Buffer.from(`${this.clientID}:${this.clientSecret}`).toString("base64");
        this.token = "";
        this.options = {
            headers: {
                "Content-Type": "application/json",
                Authorization: this.token
            }
        };

        this.functions = {
            track: this.getTrack.bind(this),
            album: this.getAlbumTracks.bind(this),
            playlist: this.getPlaylistTracks.bind(this),
        };

        this.renew();
    }

    public load(manager: Manager) {
        this.manager = manager;
        this._search = manager.search;
        manager.search = this.search.bind(this);
    }

    private async search(query: string | Query, requester?: unknown): Promise<SearchResult> {
        const finalQuery = (query as Query).query || query as string;
        const [, type, id] = REGEX.test(finalQuery) ? finalQuery.match(REGEX) : []

        if (type in this.functions) {
            try {
                const func = this.functions[type];

                if (func) {
                    const data = await func(id);
                    const loadType = type === "track" ? "TRACK_LOADED" : "PLAYLIST_LOADED";
                    const name = ["playlist", "album"].includes(type) ? data.name : null;
                    return buildSearch(loadType, data.tracks.map(track => TrackUtils.build(track, requester)), null, name);
                }

                throw new Error('Incorrect type for Spotify URL, must be one of "track", "album", "playlist".');
            } catch (e) {
                return buildSearch("LOAD_FAILED", null, e.message, null);
            }
        }

        return this._search(query, requester);
    }

    private async getAlbumTracks(id: string): Promise<Result> {
        const { data }: { data: Album } = await Axios.get(`${BASE_URL}/albums/${id}`, this.options);
        return {
            tracks: await Promise.all(data.tracks.items.map(async item => await this.fetchTrack(item))),
            name: data.name
        };
    }

    private async getPlaylistTracks(id: string): Promise<Result> {
        const { data }: { data: PlaylistItems } = await Axios.get(`${BASE_URL}/playlists/${id}`, this.options);

        return {
            tracks: await Promise.all(data.tracks.items.map(async item => await this.fetchTrack(item.track))),
            name: data.name
        };
    }

    private async getTrack(id: string): Promise<Result> {
        const { data }: { data: SpotifyTrack } = await Axios.get(`${BASE_URL}/tracks/${id}`, this.options);
        return { tracks: [ await this.fetchTrack(data) ] };
    }

    private async fetchTrack(track: SpotifyTrack): Promise<TrackData> {
        if (!track) throw new ReferenceError("The Spotify track object was not provided");
        if (!track.artists) throw new ReferenceError("The track artists array was not provided");
        if (!track.name) throw new ReferenceError("The track name was not provided");
        if (!Array.isArray(track.artists)) throw new TypeError(`The track artists must be an array, received type ${typeof track.artists}`);
        if (typeof track.name !== "string") throw new TypeError(`The track name must be a string, received type ${typeof track.name}`);

        const title = `${track.artists[0].name} - ${track.name}`;

        const node = this.manager.leastUsedNodes.first();
        if (!node) throw new Error("No available node.");

        const { host, port, password, secure } = node.options;
        const url = `http${secure ? "s" : ""}://${host}:${port}/loadtracks`

        const { data } = await Axios.get<LavalinkResult>(url, {
            headers: { Authorization: password },
            params: { identifier: `ytsearch:${title}` }
        });

        if (data.loadType === "LOAD_FAILED") throw data;

        const regexEscape = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const originalAudio = data.tracks.filter(searchResult => {
            return [track.artists[0].name, `${track.artists[0].name} - Topic`].some(channelName => new RegExp(`^${regexEscape(channelName)}$`, "i").test(searchResult.info.author)) ||
                new RegExp(`^${regexEscape(track.name)}$`, "i").test(searchResult.info.title);
        })[0];

        if (originalAudio) return originalAudio;

        const sameDuration = data.tracks.filter(searchResult => (searchResult.info.length >= (track.duration_ms - 1500)) && (searchResult.info.length <= (track.duration_ms + 1500)))[0];
        if (sameDuration) return sameDuration;

        return data.tracks[0];
    }

    private async renewToken(): Promise<number> {
        const { data: { access_token, expires_in }} = await Axios.post(
            "https://accounts.spotify.com/api/token",
            "grant_type=client_credentials",
            {
                headers: {
                    Authorization: `Basic ${this.authorization}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );

        if (!access_token) throw new Error("Invalid Spotify client.");

        this.token = `Bearer ${access_token}`;
        this.options.headers.Authorization = this.token;

        return expires_in * 1000;
    }

    private async renew(): Promise<void> {
        setTimeout(this.renew.bind(this), await this.renewToken());
    }
}

export interface Result {
    tracks: TrackData[];
    name?: string;
}

export interface LavalinkResult {
    tracks: TrackData[];
    loadType: string;
    exception?: {
        /** The message for the exception. */
        message: string;
        /** The severity of exception. */
        severity: string;
    };
    playlistInfo: {
        name: string;
        selectedTrack?: number;
    }
}

export interface SpotifyOptions {
    clientID: string;
    clientSecret: string;
}

export interface Album {
    name: string;
    tracks: {
        items: SpotifyTrack[];
    };
}

export interface Artist {
    name: string;
}

export interface PlaylistItems {
    tracks: {
        items: [
            {
                track: SpotifyTrack;
            }
        ];
    };
    name: string;
}

export interface SpotifyTrack {
    artists: Artist[];
    name: string;
    duration_ms: number;
}