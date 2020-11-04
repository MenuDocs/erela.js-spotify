import { Manager, Plugin, UnresolvedTrack } from "erela.js";
export declare class Spotify extends Plugin {
    private readonly clientID;
    private readonly clientSecret;
    private readonly authorization;
    private token;
    private readonly options;
    private _search;
    private manager;
    private readonly functions;
    constructor(options: SpotifyOptions);
    load(manager: Manager): void;
    private search;
    private getAlbumTracks;
    private getPlaylistTracks;
    private getTrack;
    private static convertToUnresolved;
    private renewToken;
    private renew;
}
export interface Result {
    tracks: UnresolvedTrack[];
    name?: string;
}
export interface SpotifyOptions {
    clientID: string;
    clientSecret: string;
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
        message: string;
    };
    loadType: string;
    playlist?: {
        duration: number;
        name: string;
    };
    tracks: UnresolvedTrack[];
}
