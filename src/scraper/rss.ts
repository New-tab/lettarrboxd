import * as cheerio from 'cheerio';
import { LetterboxdMovie } from './index';

export function extractUsernameFromLetterboxdUrl(url: string): string | null {
  const match = url.match(/^https:\/\/letterboxd\.com\/([^\/]+)\//);
  return match ? match[1] : null;
}

export function buildRssUrl(letterboxdUrl: string): string {
  const username = extractUsernameFromLetterboxdUrl(letterboxdUrl);
  if (!username) {
    throw new Error(`Could not extract username from URL: ${letterboxdUrl}`);
  }
  return `https://letterboxd.com/${username}/rss/`;
}

export function parseFilmSlugFromLink(link: string): string {
  const match = link.match(/\/film\/([^\/]+)\/?$/);
  return match ? `/film/${match[1]}/` : link;
}

export function parseRssFeed(xml: string): LetterboxdMovie[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const movies: LetterboxdMovie[] = [];

  $('item').each((_, item) => {
    const $item = $(item);

    // Only include diary/watched entries — they have a watchedDate field
    const watchedDate = $item.find('letterboxd\\:watchedDate').text().trim();
    if (!watchedDate) {
      return;
    }

    const tmdbIdText = $item.find('tmdb\\:movieId').text().trim();
    const tmdbIdNum = tmdbIdText ? parseInt(tmdbIdText, 10) : null;

    // Skip entries without a TMDB ID (TV shows, short films, etc.)
    if (!tmdbIdNum || isNaN(tmdbIdNum)) {
      return;
    }

    const filmTitle = $item.find('letterboxd\\:filmTitle').text().trim();
    const filmYearText = $item.find('letterboxd\\:filmYear').text().trim();
    const link = $item.find('link').text().trim();
    const slug = parseFilmSlugFromLink(link);

    movies.push({
      id: tmdbIdNum,
      name: filmTitle || 'Unknown',
      tmdbId: String(tmdbIdNum),
      publishedYear: filmYearText ? parseInt(filmYearText, 10) : null,
      slug,
    });
  });

  return movies;
}

export interface RssFetchResult {
  movies: LetterboxdMovie[];
  etag: string | null;
}

export class RssScraper {
  private rssUrl: string;

  constructor(letterboxdUrl: string) {
    this.rssUrl = buildRssUrl(letterboxdUrl);
  }

  async getMovies(etag?: string | null): Promise<RssFetchResult | null> {
    const headers: Record<string, string> = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const response = await fetch(this.rssUrl, { headers });

    if (response.status === 304) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch RSS feed: ${response.status}`);
    }

    const newEtag = response.headers.get('etag');
    const xml = await response.text();
    return {
      movies: parseRssFeed(xml),
      etag: newEtag,
    };
  }
}
