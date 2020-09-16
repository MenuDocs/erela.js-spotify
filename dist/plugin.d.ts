import { Manager, Plugin } from "erela.js";
import { TrackData } from "erela.js/structures/Utils";
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
    private fetchTrack;
    private renewToken;
    private renew;
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
