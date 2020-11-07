import {
    Manager,
    Plugin,
    TrackUtils,
    UnresolvedTrack,
    UnresolvedQuery,
    LoadType,
    SearchQuery
} from "erela.js";
import Axios from "axios";

const BASE_URL = "https://api.spotify.com/v1";
const REGEX = /(?:https:\/\/open\.spotify\.com\/|spotify:)(.+)(?:[\/:])([A-Za-z0-9]+)/;

const buildSearch = (loadType: LoadType, tracks: UnresolvedTrack[], error: string, name: string): SearchResult => ({
    loadType: loadType,
    tracks: tracks ?? [],
    playlist: name ? {
        name,
        duration: tracks
            .reduce(
                (acc: number, cur: UnresolvedTrack) => acc + (cur.duration || 0),
                0
            ),
    } : null,
    exception: error ? {
        message: error,
        severity: "COMMON"
    } : null,
});

const check = (options: SpotifyOptions) => {
    if (!options) throw new TypeError("SpotifyOptions must not be empty.");

    if (typeof options.clientID !== "string" || !/^.+$/.test(options.clientID))
        throw new TypeError(
            'Spotify option "clientID" must be present and be a non-empty string.'
        );

    if (typeof options.clientSecret !== "string" || !/^.+$/.test(options.clientSecret))
        throw new TypeError(
            'Spotify option "clientSecret" must be a non-empty string.'
        );

    if (
        typeof options.convertUnresolved !== "undefined" &&
        typeof options.convertUnresolved !== "boolean"
    )
        throw new TypeError(
            'Spotify option "convertUnresolved" must be a boolean.'
        );

    if (
        typeof options.playlistLimit !== "undefined" &&
        typeof options.playlistLimit !== "number"
    )
        throw new TypeError('Spotify option "playlistLimit" must be a number.');

    if (
        typeof options.albumLimit !== "undefined" &&
        typeof options.albumLimit !== "number"
    )
        throw new TypeError('Spotify option "albumLimit" must be a number.');
}

export class Spotify extends Plugin {
    private readonly authorization: string;
    private token: string;
    private readonly axiosOptions: { headers: { Authorization: string; "Content-Type": string } };
    private _search: (query: string | SearchQuery, requester?: unknown) => Promise<SearchResult>;
    private manager: Manager;
    private readonly functions: Record<string, Function>;
    private readonly options: SpotifyOptions;

    public constructor(options: SpotifyOptions) {
        super();
        check(options);
        this.options = {
            ...options
        }

        this.token = "";
        this.authorization = Buffer.from(
            `${this.options.clientID}:${this.options.clientSecret}`
        ).toString("base64");
        this.axiosOptions = {
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

    private async search(query: string | SearchQuery, requester?: unknown): Promise<SearchResult> {
        const finalQuery = (query as SearchQuery).query || query as string;
        const [, type, id] = finalQuery.match(REGEX) ?? [];

        if (type in this.functions) {
            try {
                const func = this.functions[type];

                if (func) {
                    const data: Result = await func(id);

                    const loadType = type === "track" ? "TRACK_LOADED" : "PLAYLIST_LOADED";
                    const name = ["playlist", "album"].includes(type) ? data.name : null;
                    const tracks = data.tracks.map(query =>  {
                        const track = TrackUtils.buildUnresolved(query, requester);
                        if (this.options.convertUnresolved) track.resolve();
                        return track
                    });

                    return buildSearch(loadType, tracks, null, name);
                }

                const msg = 'Incorrect type for Spotify URL, must be one of "track", "album" or "playlist".';
                return buildSearch("LOAD_FAILED", null, msg, null);
            } catch (e) {
                return buildSearch(e.loadType ?? "LOAD_FAILED", null, e.message ?? null, null);
            }
        }

        return this._search(query, requester);
    }

    private async getAlbumTracks(id: string): Promise<Result> {
        const { data: album } = await Axios.get<Album>(`${BASE_URL}/albums/${id}`, this.axiosOptions);
        const tracks = album.tracks.items.map(item => Spotify.convertToUnresolved(item));
        let next = album.tracks.next, page = 1;

        while (next && !this.options.playlistLimit ? true : page < this.options.albumLimit) {
            const { data: nextPage } = await Axios.get<AlbumTracks>(next, this.axiosOptions);
            tracks.push(...nextPage.items.map(item => Spotify.convertToUnresolved(item)));
            next = nextPage.next;
            page++;
        }

        return { tracks, name: album.name };
    }

    private async getPlaylistTracks(id: string): Promise<Result> {
        let { data: playlist } = await Axios.get<Playlist>(`${BASE_URL}/playlists/${id}`, this.axiosOptions);
        const tracks = playlist.tracks.items.map(item => Spotify.convertToUnresolved(item.track));
        let next = playlist.tracks.next, page = 1;

        while (next && !this.options.playlistLimit ? true : page < this.options.playlistLimit) {
            const { data: nextPage } = await Axios.get<PlaylistTracks>(next, this.axiosOptions);
            tracks.push(...nextPage.items.map(item => Spotify.convertToUnresolved(item.track)));
            next = nextPage.next;
            page++;
        }

        return { tracks, name: playlist.name };
    }

    private async getTrack(id: string): Promise<Result> {
        const { data } = await Axios.get<SpotifyTrack>(`${BASE_URL}/tracks/${id}`, this.axiosOptions);
        const track = Spotify.convertToUnresolved(data);
        return { tracks: [track] };
    }

    private static convertToUnresolved(track: SpotifyTrack): UnresolvedQuery {
        if (!track) throw new ReferenceError("The Spotify track object was not provided");
        if (!track.artists) throw new ReferenceError("The track artists array was not provided");
        if (!track.name) throw new ReferenceError("The track name was not provided");
        if (!Array.isArray(track.artists)) throw new TypeError(`The track artists must be an array, received type ${typeof track.artists}`);
        if (typeof track.name !== "string") throw new TypeError(`The track name must be a string, received type ${typeof track.name}`);

        return {
            title: track.name,
            author: track.artists[0].name,
            duration: track.duration_ms,
        }
    }

    private async renewToken(): Promise<number> {
        const { data: { access_token, expires_in } } = await Axios.post(
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
        this.axiosOptions.headers.Authorization = this.token;

        return expires_in * 1000;
    }

    private async renew(): Promise<void> {
        setTimeout(this.renew.bind(this), await this.renewToken());
    }
}

export interface SpotifyOptions {
    clientID: string;
    clientSecret: string;
    /** Amount of pages to load, each page having 100 tracks. */
    playlistLimit?: number
    /** Amount of pages to load, each page having 50 tracks. */
    albumLimit?: number
    /**
     * Whether to convert UnresolvedTracks to Track. Defaults to false.
     * **Note: This is** ***not*** **recommended as it spams YouTube and takes a while if a large playlist is loaded.**
     */
    convertUnresolved?: boolean
}

export interface Result {
    tracks: UnresolvedQuery[];
    name?: string;
}

export interface Album {
    name: string;
    tracks: AlbumTracks;
}

export interface AlbumTracks {
    items: SpotifyTrack[];
    next: string | null;
}

export interface Artist {
    name: string;
}

export interface Playlist {
    tracks: PlaylistTracks;
    name: string;
}

export interface PlaylistTracks {
    items: [
        {
            track: SpotifyTrack;
        }
    ];
    next: string | null;
}

export interface SpotifyTrack {
    artists: Artist[];
    name: string;
    duration_ms: number;
}

export interface SearchResult {
    exception?: {
        severity: string;
        message: string
    };
    loadType: string;
    playlist?: {
        duration: number;
        name: string
    };
    tracks: UnresolvedTrack[]
}