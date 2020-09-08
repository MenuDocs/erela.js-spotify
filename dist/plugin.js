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
const REGEX = /https:\/\/open\.spotify\.com\/(.+)\/([A-Za-z0-9]+)/;
const buildSearch = (loadType, tracks, error, name) => ({
    loadType: loadType,
    tracks: tracks !== null && tracks !== void 0 ? tracks : [],
    playlist: name ? {
        name,
        duration: tracks
            .map(track => track.duration)
            .reduce((acc, cur) => acc + cur, 0)
    } : undefined,
    exception: {
        message: error,
        severity: "COMMON"
    },
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
        return __awaiter(this, void 0, void 0, function* () {
            const finalQuery = query.query || query;
            const [, type, id] = REGEX.test(finalQuery) ? finalQuery.match(REGEX) : [];
            if (type in this.functions) {
                try {
                    const func = this.functions[type];
                    if (func) {
                        const data = yield func(id);
                        const loadType = type === "track" ? "TRACK_LOADED" : "PLAYLIST_LOADED";
                        const name = ["playlist", "album"].includes(type) ? data.name : null;
                        return buildSearch(loadType, data.tracks.map(track => erela_js_1.TrackUtils.build(track, requester)), null, name);
                    }
                    const msg = 'Incorrect type for Spotify URL, must be one of "track", "album", "playlist".';
                    return buildSearch("LOAD_FAILED", null, msg, null);
                }
                catch (e) {
                    return buildSearch("LOAD_FAILED", null, e.message, null);
                }
            }
            return this._search(query, requester);
        });
    }
    getAlbumTracks(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data } = yield axios_1.default.get(`${BASE_URL}/albums/${id}`, this.options);
            return {
                tracks: yield Promise.all(data.tracks.items.map((item) => __awaiter(this, void 0, void 0, function* () { return yield this.fetchTrack(item); }))),
                name: data.name
            };
        });
    }
    getPlaylistTracks(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data } = yield axios_1.default.get(`${BASE_URL}/playlists/${id}`, this.options);
            return {
                tracks: yield Promise.all(data.tracks.items.map((item) => __awaiter(this, void 0, void 0, function* () { return yield this.fetchTrack(item.track); }))),
                name: data.name
            };
        });
    }
    getTrack(id) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data } = yield axios_1.default.get(`${BASE_URL}/tracks/${id}`, this.options);
            return { tracks: [yield this.fetchTrack(data)] };
        });
    }
    fetchTrack(track) {
        return __awaiter(this, void 0, void 0, function* () {
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
            const title = `${track.artists[0].name} - ${track.name}`;
            const node = this.manager.leastUsedNodes.first();
            if (!node)
                throw new Error("No available node.");
            const { host, port, password, secure } = node.options;
            const url = `http${secure ? "s" : ""}://${host}:${port}/loadtracks`;
            const { data } = yield axios_1.default.get(url, {
                headers: { Authorization: password },
                params: { identifier: `ytsearch:${title}` }
            });
            if (data.loadType === "LOAD_FAILED")
                throw data;
            const regexEscape = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const originalAudio = data.tracks.filter(searchResult => {
                return [track.artists[0].name, `${track.artists[0].name} - Topic`].some(channelName => new RegExp(`^${regexEscape(channelName)}$`, "i").test(searchResult.info.author)) ||
                    new RegExp(`^${regexEscape(track.name)}$`, "i").test(searchResult.info.title);
            })[0];
            if (originalAudio)
                return originalAudio;
            const sameDuration = data.tracks.filter(searchResult => (searchResult.info.length >= (track.duration_ms - 1500)) && (searchResult.info.length <= (track.duration_ms + 1500)))[0];
            if (sameDuration)
                return sameDuration;
            return data.tracks[0];
        });
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