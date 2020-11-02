<div align = "center">
    <a href="https://discord.gg/D6FXw55">
<img src="https://img.shields.io/discord/653436871858454538?color=7289DA&label=Support&logo=discord&style=for-the-badge" alt="Discord">
</a> 

<a href="https://www.npmjs.com/package/erela.js-spotify">
<img src="https://img.shields.io/npm/dw/erela.js-spotify?color=CC3534&logo=npm&style=for-the-badge" alt="Downloads">
</a>

<a href="https://www.npmjs.com/package/erela.js-spotify">
<img src="https://img.shields.io/npm/v/erela.js-spotify?color=red&label=Version&logo=npm&style=for-the-badge" alt="Npm version">
</a>

<br>

<a href="https://github.com/Solaris9/erela.js-spotify">
<img src="https://img.shields.io/github/stars/Solaris9/erela.js-spotify?color=333&logo=github&style=for-the-badge" alt="Github stars">
</a>

<a href="https://github.com/Solaris9/erela.js-spotify/blob/master/LICENSE">
<img src="https://img.shields.io/github/license/Solaris9/erela.js-spotify?color=6e5494&logo=github&style=for-the-badge" alt="License">
</a>
<hr>
</div>

This a plugin for Erela.JS to allow the use of Spotify URL's, it uses direct URL's being tracks, albums, and playlists and gets the YouTube equivalent.

- https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC
- https://open.spotify.com/album/6N9PS4QXF1D0OWPk0Sxtb4
- https://open.spotify.com/playlist/37i9dQZF1DZ06evO05tE88

## Documentation & Guides

It is recommended to read the documentation to start, and the guides to use the plugin.

- [Documentation](http://projects.solaris.codes/erelajs/docs/gettingstarted.html 'Erela.js Documentation') 

- [Guides](http://projects.solaris.codes/erelajs/guides/introduction.html 'Erela.js Guides')

## Prerequisites

- [Spotify App](https://developer.spotify.com/dashboard) for the **clientID** & **clientSecret**

## Installation

**NPM** :
```sh
npm install erela.js-spotify
```

**Yarn** :
```sh
yarn add erela.js-spotify
```

## Example Usage

<h3>Note:</h3>

> This assumes you already have Erela.JS setup. Refer to the <a href="#documentation--guides">guides</a> to start.
>
> This is also part of the code, it only shows using the plugin.

```javascript
const { Manager } = require("erela.js");
const Spotify  = require("erela.js-spotify");

const clientID = ""; // clientID from your Spotify app
const clientSecret = ""; // clientSecret from your Spotify app

const manager = new Manager({
  plugins: [ new Spotify({ clientID, clientSecret }) ]
});

manager.search("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
```