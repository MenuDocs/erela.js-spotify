import { Manager, Plugin, TrackUtils } from "erela.js";
import { LoadType, TrackData } from "erela.js/structures/Utils";
import { LavalinkResult, Query, SearchResult } from "erela.js/structures/Manager";
import { Track } from "erela.js/structures/Player";
import Axios from "axios";

const TEMPLATE = [ "clientID", "clientSecret" ];
const BASE_URL = "https://api.spotify.com/v1";
const REGEX = /(?:https:\/\/open\.spotify\.com\/|spotify:)(.+)(?:[\/:])([A-Za-z0-9]+)/;

const buildSearch = (loadType: LoadType, tracks: Track[], error: string, name: string): SearchResult => ({
    loadType: loadType,
    tracks: tracks ?? [],
    playlist: name ? {
        name,
        duration: tracks
            .map(track => track.duration)
            .reduce((acc: number, cur: number) => acc + cur, 0)
    } : null,
    exception: error ? {
        message: error,
        severity: "COMMON"
    } : null,
});

export class Spotify extends Plugin {
    private readonly clientID: string;
    private readonly clientSecret: string;
    private readonly authorization: string;
    private token: string;
    private readonly options: { headers: { Authorization: string; "Content-Type": string } };
    private _search: (query: string | Query, requester?: unknown) => Promise<SearchResult>;
    private manager: Manager;
    private readonly functions: Record<string, Function>;

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
        this._search = manager.search.bind(manager);
        manager.search = this.search.bind(this);
    }

    private async search(query: string | Query, requester?: unknown): Promise<SearchResult> {
        const finalQuery = (query as Query).query || query as string;
        const [, type, id] = REGEX.test(finalQuery) ? finalQuery.match(REGEX) : [];

        if (type in this.functions) {
            try {
                const func = this.functions[type];

                if (func) {
                    const data = await func(id);
                    const loadType = type === "track" ? "TRACK_LOADED" : "PLAYLIST_LOADED";
                    const name = ["playlist", "album"].includes(type) ? data.name : null;
                    const tracks = data.tracks.map(track => TrackUtils.build(track, requester));

                    return buildSearch(loadType, tracks, null, name);
                }

                const msg = 'Incorrect type for Spotify URL, must be one of "track", "album", "playlist".';
                return buildSearch("LOAD_FAILED", null, msg, null);
            } catch (e) {
                return buildSearch(e.loadType ?? "LOAD_FAILED", null, e.message ?? null, null);
            }
        }

        return this._search(query, requester);
    }

    private async getAlbumTracks(id: string): Promise<Result> {
        const { data } = await Axios.get<Album>(`${BASE_URL}/albums/${id}`, this.options);
        const promises = data.tracks.items.map(async item => await this.fetchTrack(item));
        const tracks = (await Promise.all(promises)).filter(e => !!e);

        if (!tracks.length) throw { loadType: "NO_MATCHES" };

        return {
            tracks,
            name: data.name
        };
    }

    private async getPlaylistTracks(id: string): Promise<Result> {
        const { data } = await Axios.get<PlaylistItems>(`${BASE_URL}/playlists/${id}`, this.options);
        const promises = data.tracks.items.map(async item => await this.fetchTrack(item.track));
        const tracks = (await Promise.all(promises)).filter(e => !!e);

        if (!tracks.length) throw { loadType: "NO_MATCHES" };

        return {
            tracks,
            name: data.name
        };
    }

    private async getTrack(id: string): Promise<Result> {
        const { data } = await Axios.get<SpotifyTrack>(`${BASE_URL}/tracks/${id}`, this.options);
        const track = await this.fetchTrack(data);

        if (!track) throw { loadType: "NO_MATCHES" };

        return { tracks: [ track ] };
    }

    private async fetchTrack(track: SpotifyTrack): Promise<TrackData|null> {
        if (!track) throw new ReferenceError("The Spotify track object was not provided");
        if (!track.artists) throw new ReferenceError("The track artists array was not provided");
        if (!track.name) throw new ReferenceError("The track name was not provided");
        if (!Array.isArray(track.artists)) throw new TypeError(`The track artists must be an array, received type ${typeof track.artists}`);
        if (typeof track.name !== "string") throw new TypeError(`The track name must be a string, received type ${typeof track.name}`);

        const title = `${track.artists[0].name} - ${track.name}`;

        const node = this.manager.leastUsedNodes.first();
        if (!node) throw new Error("No available node.");

        const { host, port, password, secure } = node.options;
        const url = `http${secure ? "s" : ""}://${host}:${port}/loadtracks`;

        const { data } = await Axios.get<LavalinkResult>(url, {
            headers: { Authorization: password },
            params: { identifier: `ytsearch:${title}` }
        });

        if (["LOAD_FAILED", "NO_MATCHES"].includes(data.loadType)) return null;

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