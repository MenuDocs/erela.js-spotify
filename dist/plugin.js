"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Spotify = void 0;
const erela_js_1 = require("erela.js");
const petitio_1 = __importDefault(require("petitio"));
const BASE_URL = "https://api.spotify.com/v1";
const REGEX = /(?:https:\/\/open\.spotify\.com\/|spotify:)(?:.+)?(track|playlist|album)[\/:]([A-Za-z0-9]+)/;
const buildSearch = (loadType, tracks, error, name) => ({
    loadType: loadType,
    tracks: tracks ?? [],
    playlist: name ? {
        name,
        duration: tracks
            .reduce((acc, cur) => acc + (cur.duration || 0), 0),
    } : null,
    exception: error ? {
        message: error,
        severity: "COMMON",
    } : null,
});
const check = (options) => {
    if (!options) {
        throw new TypeError("SpotifyOptions must not be empty.");
    }
    if (typeof options.clientID !== "string" || !/^.+$/.test(options.clientID)) {
        throw new TypeError("Spotify option \"clientID\" must be present and be a non-empty string.");
    }
    if (typeof options.clientSecret !== "string" || !/^.+$/.test(options.clientSecret)) {
        throw new TypeError("Spotify option \"clientSecret\" must be a non-empty string.");
    }
    if (typeof options.convertUnresolved !== "undefined" &&
        typeof options.convertUnresolved !== "boolean") {
        throw new TypeError("Spotify option \"convertUnresolved\" must be a boolean.");
    }
    if (typeof options.playlistLimit !== "undefined" &&
        typeof options.playlistLimit !== "number") {
        throw new TypeError("Spotify option \"playlistLimit\" must be a number.");
    }
    if (typeof options.albumLimit !== "undefined" &&
        typeof options.albumLimit !== "number") {
        throw new TypeError("Spotify option \"albumLimit\" must be a number.");
    }
};
class Spotify extends erela_js_1.Plugin {
    constructor(options) {
        super();
        check(options);
        this.options = {
            ...options,
        };
        this.token = "";
        this.authorization = Buffer
            .from(`${this.options.clientID}:${this.options.clientSecret}`)
            .toString("base64");
        this.functions = {
            track: this.getTrack.bind(this),
            album: this.getAlbumTracks.bind(this),
            playlist: this.getPlaylistTracks.bind(this),
        };
        this.renew();
    }
    load(manager) {
        this.manager = manager;
        this._search = manager.search.bind(manager);
        manager.search = this.search.bind(this);
    }
    makeRequest(endpoint, modify = () => void 0) {
        const req = (0, petitio_1.default)(`${BASE_URL}${/^\//.test(endpoint) ? endpoint : `/${endpoint}`}`)
            .header("Authorization", this.token);
        modify(req);
        return req.json();
    }
    async search(query, requester) {
        const finalQuery = query.query || query;
        const [, type, id] = finalQuery.match(REGEX) ?? [];
        if (type in this.functions) {
            try {
                const func = this.functions[type];
                if (func) {
                    const data = await func(id);
                    const loadType = type === "track" ? "TRACK_LOADED" : "PLAYLIST_LOADED";
                    const name = ["playlist", "album"].includes(type) ? data.name : null;
                    const tracks = data.tracks.map(query => {
                        const track = erela_js_1.TrackUtils.buildUnresolved(query, requester);
                        if (this.options.convertUnresolved) {
                            try {
                                track.resolve();
                            }
                            catch {
                                return null;
                            }
                        }
                        return track;
                    }).filter(track => !!track);
                    return buildSearch(loadType, tracks, null, name);
                }
                const msg = "Incorrect type for Spotify URL, must be one of \"track\", \"album\" or \"playlist\".";
                return buildSearch("LOAD_FAILED", null, msg, null);
            }
            catch (e) {
                return buildSearch(e.loadType ?? "LOAD_FAILED", null, e.message ?? null, null);
            }
        }
        return this._search(query, requester);
    }
    async getAlbumTracks(id) {
        const album = await this.makeRequest(`albums/${id}`);
        const tracks = album.tracks.items.filter(this.filterNullOrUndefined).map(item => Spotify.convertToUnresolved(item));
        let next = album.tracks.next, page = 1;
        while (next && !this.options.playlistLimit ? true : page < this.options.albumLimit) {
            const nextPage = await this.makeRequest(next);
            tracks.push(...nextPage.items.filter(this.filterNullOrUndefined).map(item => Spotify.convertToUnresolved(item)));
            next = nextPage.next;
            page++;
        }
        return { tracks, name: album.name };
    }
    async getPlaylistTracks(id) {
        const playlist = await this.makeRequest(`playlists/${id}`);
        const tracks = playlist.tracks.items.filter(this.filterNullOrUndefined).map(item => Spotify.convertToUnresolved(item.track));
        let next = playlist.tracks.next, page = 1;
        while (next && !this.options.playlistLimit ? true : page < this.options.playlistLimit) {
            const nextPage = await this.makeRequest(next);
            tracks.push(...nextPage.items.filter(this.filterNullOrUndefined).map(item => Spotify.convertToUnresolved(item.track)));
            next = nextPage.next;
            page++;
        }
        return { tracks, name: playlist.name };
    }
    async getTrack(id) {
        const data = await this.makeRequest(`tracks/${id}`);
        const track = Spotify.convertToUnresolved(data);
        return { tracks: [track] };
    }
    static convertToUnresolved(track) {
        if (!track)
            throw new ReferenceError("The Spotify track object was not provided");
        if (!track.artists)
            throw new ReferenceError("The track artists array was not provided");
        if (!track.name)
            throw new ReferenceError("The track name was not provided");
        if (!Array.isArray(track.artists))
            throw new TypeError(`The track artists must be an array, received type ${typeof track.artists}`);
        if (typeof track.name !== "string")
            throw new TypeError(`The track name must be a string, received type ${typeof track.name}`);
        return {
            title: track.name,
            author: track.artists[0].name,
            duration: track.duration_ms,
        };
    }
    async renewToken() {
        const { access_token, expires_in } = await (0, petitio_1.default)("https://accounts.spotify.com/api/token", "POST")
            .query("grant_type", "client_credentials")
            .header("Authorization", `Basic ${this.authorization}`)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .json();
        if (!access_token) {
            throw new Error("Invalid Spotify client.");
        }
        this.token = `Bearer ${access_token}`;
        return expires_in * 1000;
    }
    async renew() {
        const expiresIn = await this.renewToken();
        setTimeout(() => this.renew(), expiresIn);
    }
    filterNullOrUndefined(value) {
        return typeof value !== 'undefined' ? value !== null : typeof value !== 'undefined';
    }
}
exports.Spotify = Spotify;
