// Raw Jamendo API v3.0 response shapes (https://developer.jamendo.com/v3.0).
// Only the fields we use are declared. Note: /albums/tracks returns numbers as strings
// (e.g. "duration":"192"), so numeric fields are typed `number | string`.

export interface JamendoHeaders {
  /** "success" | "failed" — errors still come back with HTTP 200. */
  status: string;
  code: number;
  error_message: string;
  warnings: string;
  results_count: number;
}

export interface JamendoResponse<T> {
  headers: JamendoHeaders;
  results: T[];
}

export interface JamendoMusicInfo {
  vocalinstrumental?: string;
  acousticelectric?: string;
  speed?: string;
  tags?: {
    genres?: string[];
    instruments?: string[];
    vartags?: string[];
  };
}

/** GET /tracks result item. */
export interface JamendoTrack {
  id: string;
  name: string;
  duration: number | string;
  artist_id: string;
  artist_name: string;
  album_name: string;
  album_id: string;
  license_ccurl: string;
  position: number | string;
  releasedate: string;
  album_image: string;
  /** Stream URL. */
  audio: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  shorturl?: string;
  shareurl: string;
  image: string;
  /** Present with include=musicinfo. */
  musicinfo?: JamendoMusicInfo;
}

/** Track entry nested in a GET /albums/tracks result. */
export interface JamendoAlbumTrack {
  id: string;
  position: number | string;
  name: string;
  duration: number | string;
  license_ccurl: string;
  audio: string;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
}

/** GET /albums and GET /albums/tracks result item. */
export interface JamendoAlbum {
  id: string;
  name: string;
  releasedate: string;
  artist_id: string;
  artist_name: string;
  image: string;
  shorturl?: string;
  shareurl?: string;
  zip?: string;
  /** Present on /albums/tracks only. */
  tracks?: JamendoAlbumTrack[];
}
