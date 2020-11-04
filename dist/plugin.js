"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Spotify = void 0;
const erela_js_1 = require("erela.js");
const axios_1 = __importDefault(require("axios"));
const TEMPLATE = ["clientID", "clientSecret"];
const BASE_URL = "https://api.spotify.com/v1";
const REGEX = /(?:https:\/\/open\.spotify\.com\/|spotify:)(.+)(?:[\/:])([A-Za-z0-9]+)/;
const buildSearch = (loadType, tracks, error, name) => ({
    loadType: loadType,
    tracks: tracks !== null && tracks !== void 0 ? tracks : [],
    playlist: name ? {
        name,
        duration: tracks
            .reduce((acc, cur) => acc + (cur.duration || 0), 0),
    } : null,
    exception: error ? {
        message: error,
        severity: "COMMON"
    } : null,
});
class Spotify extends erela_js_1.Plugin {
    constructor(options) {
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
    load(manager) {
        this.manager = manager;
        this._search = manager.search.bind(manager);
        manager.search = this.search.bind(this);
    }
    search(query, requester) {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            const finalQuery = query.query || query;
            const [, type, id] = (_a = finalQuery.match(REGEX)) !== null && _a !== void 0 ? _a : [];
            if (type in this.functions) {
                try {
                    const func = this.functions[type];
                    if (func) {
                        const data = yield func(id);
                        const loadType = type === "track" ? "TRACK_LOADED" : "PLAYLIST_LOADED";
                        const name = ["playlist", "album"].includes(type) ? data.name : null;
                        const tracks = data.tracks.map(track => erela_js_1.TrackUtils.buildUnresolved(track, requester));
                        return buildSearch(loadType, tracks, null, name);
                    }
                    const msg = 'Incorrect type for Spotify URL, must be one of "track", "album", "playlist".';
                    return buildSearch("LOAD_FAILED", null, msg, null);
                }
                catch (e) {
                    return buildSearch((_b = e.loadType) !== null && _b !== void 0 ? _b : "LOAD_FAILED", null, (_c = e.message) !== null && _c !== void 0 ? _c : null, null);
                }
            }
            return this._search(query, requester);
        });
    }
    getAlbumTracks(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data: album } = yield axios_1.default.get(`${BASE_URL}/albums/${id}`, this.options);
            const tracks = album.tracks.items.map(item => Spotify.convertToUnresolved(item));
            let next = album.tracks.next;
            while (next) {
                const { data: nextPage } = yield axios_1.default.get(album.tracks.next, this.options);
                tracks.push(...nextPage.items.map(item => Spotify.convertToUnresolved(item)));
                next = nextPage.next;
            }
            return { tracks, name: album.name };
        });
    }
    getPlaylistTracks(id) {
        return __awaiter(this, void 0, void 0, function* () {
            let { data: playlist } = yield axios_1.default.get(`${BASE_URL}/playlists/${id}`, this.options);
            const tracks = playlist.tracks.items.map(item => Spotify.convertToUnresolved(item.track));
            let next = playlist.tracks.next;
            while (next !== null) {
                const { data: nextPage } = yield axios_1.default.get(playlist.tracks.next, this.options);
                tracks.push(...nextPage.items.map(item => Spotify.convertToUnresolved(item.track)));
                next = nextPage.next;
            }
            return { tracks, name: playlist.name };
        });
    }
    getTrack(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data } = yield axios_1.default.get(`${BASE_URL}/tracks/${id}`, this.options);
            const track = Spotify.convertToUnresolved(data);
            return { tracks: [track] };
        });
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
    renewToken() {
        return __awaiter(this, void 0, void 0, function* () {
            const { data: { access_token, expires_in } } = yield axios_1.default.post("https://accounts.spotify.com/api/token", "grant_type=client_credentials", {
                headers: {
                    Authorization: `Basic ${this.authorization}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });
            if (!access_token)
                throw new Error("Invalid Spotify client.");
            this.token = `Bearer ${access_token}`;
            this.options.headers.Authorization = this.token;
            return expires_in * 1000;
        });
    }
    renew() {
        return __awaiter(this, void 0, void 0, function* () {
            setTimeout(this.renew.bind(this), yield this.renewToken());
        });
    }
}
exports.Spotify = Spotify;
