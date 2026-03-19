import {
  buildRssUrl,
  extractUsernameFromLetterboxdUrl,
  parseFilmSlugFromLink,
  parseRssFeed,
  RssScraper,
} from './rss';

const SAMPLE_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
  xmlns:letterboxd="https://a.ltxd.com/rss/letterboxd-namespace-description.xml"
  xmlns:tmdb="https://www.themoviedb.org/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Test User's Letterboxd</title>
    <item>
      <title>There Will Be Blood, 2007 - ★★★★★</title>
      <link>https://letterboxd.com/testuser/film/there-will-be-blood/</link>
      <guid isPermaLink="false">letterboxd-watch-111</guid>
      <pubDate>Mon, 17 Mar 2026 12:00:00 +0000</pubDate>
      <letterboxd:watchedDate>2026-03-17</letterboxd:watchedDate>
      <letterboxd:rewatch>No</letterboxd:rewatch>
      <letterboxd:filmTitle>There Will Be Blood</letterboxd:filmTitle>
      <letterboxd:filmYear>2007</letterboxd:filmYear>
      <letterboxd:memberRating>5.0</letterboxd:memberRating>
      <letterboxd:memberLike>Yes</letterboxd:memberLike>
      <tmdb:movieId>7345</tmdb:movieId>
    </item>
    <item>
      <title>Aftersun, 2022 - ★★★★½</title>
      <link>https://letterboxd.com/testuser/film/aftersun/</link>
      <guid isPermaLink="false">letterboxd-watch-222</guid>
      <pubDate>Sun, 16 Mar 2026 08:00:00 +0000</pubDate>
      <letterboxd:watchedDate>2026-03-16</letterboxd:watchedDate>
      <letterboxd:rewatch>No</letterboxd:rewatch>
      <letterboxd:filmTitle>Aftersun</letterboxd:filmTitle>
      <letterboxd:filmYear>2022</letterboxd:filmYear>
      <letterboxd:memberRating>4.5</letterboxd:memberRating>
      <letterboxd:memberLike>No</letterboxd:memberLike>
      <tmdb:movieId>965150</tmdb:movieId>
    </item>
    <item>
      <title>Added to watchlist: The Dark Knight</title>
      <link>https://letterboxd.com/testuser/film/the-dark-knight/</link>
      <guid isPermaLink="false">letterboxd-list-333</guid>
      <pubDate>Sat, 15 Mar 2026 10:00:00 +0000</pubDate>
      <letterboxd:filmTitle>The Dark Knight</letterboxd:filmTitle>
      <letterboxd:filmYear>2008</letterboxd:filmYear>
      <tmdb:movieId>155</tmdb:movieId>
    </item>
    <item>
      <title>Over the Garden Wall, 2014</title>
      <link>https://letterboxd.com/testuser/film/over-the-garden-wall/</link>
      <guid isPermaLink="false">letterboxd-watch-444</guid>
      <pubDate>Fri, 14 Mar 2026 20:00:00 +0000</pubDate>
      <letterboxd:watchedDate>2026-03-14</letterboxd:watchedDate>
      <letterboxd:filmTitle>Over the Garden Wall</letterboxd:filmTitle>
      <letterboxd:filmYear>2014</letterboxd:filmYear>
    </item>
  </channel>
</rss>`;

describe('RssScraper utilities', () => {
  describe('extractUsernameFromLetterboxdUrl', () => {
    it('extracts username from watchlist URL', () => {
      expect(extractUsernameFromLetterboxdUrl('https://letterboxd.com/testuser/watchlist/')).toBe('testuser');
    });

    it('extracts username from films URL', () => {
      expect(extractUsernameFromLetterboxdUrl('https://letterboxd.com/testuser/films/')).toBe('testuser');
    });

    it('extracts username from diary URL', () => {
      expect(extractUsernameFromLetterboxdUrl('https://letterboxd.com/testuser/films/diary/')).toBe('testuser');
    });

    it('returns null for unrecognised URL', () => {
      expect(extractUsernameFromLetterboxdUrl('https://letterboxd.com/')).toBeNull();
    });
  });

  describe('buildRssUrl', () => {
    it('builds correct RSS URL from a watched movies URL', () => {
      expect(buildRssUrl('https://letterboxd.com/testuser/films/')).toBe(
        'https://letterboxd.com/testuser/rss/'
      );
    });

    it('builds correct RSS URL from a diary URL', () => {
      expect(buildRssUrl('https://letterboxd.com/testuser/films/diary/')).toBe(
        'https://letterboxd.com/testuser/rss/'
      );
    });

    it('throws for an unrecognised URL', () => {
      expect(() => buildRssUrl('https://letterboxd.com/')).toThrow(
        'Could not extract username'
      );
    });
  });

  describe('parseFilmSlugFromLink', () => {
    it('extracts slug from a user diary link', () => {
      expect(parseFilmSlugFromLink('https://letterboxd.com/testuser/film/there-will-be-blood/')).toBe(
        '/film/there-will-be-blood/'
      );
    });

    it('returns original link if pattern does not match', () => {
      const url = 'https://letterboxd.com/testuser/';
      expect(parseFilmSlugFromLink(url)).toBe(url);
    });
  });

  describe('parseRssFeed', () => {
    it('parses watched film entries with TMDB IDs', () => {
      const movies = parseRssFeed(SAMPLE_RSS);

      expect(movies).toHaveLength(2);
      expect(movies[0]).toEqual(
        expect.objectContaining({
          id: 7345,
          name: 'There Will Be Blood',
          tmdbId: '7345',
          publishedYear: 2007,
          slug: '/film/there-will-be-blood/',
        })
      );
      expect(movies[1]).toEqual(
        expect.objectContaining({
          id: 965150,
          name: 'Aftersun',
          tmdbId: '965150',
          publishedYear: 2022,
          slug: '/film/aftersun/',
        })
      );
    });

    it('skips non-diary entries (no watchedDate)', () => {
      const movies = parseRssFeed(SAMPLE_RSS);
      const titles = movies.map(m => m.name);
      expect(titles).not.toContain('The Dark Knight');
    });

    it('skips entries without a TMDB ID', () => {
      const movies = parseRssFeed(SAMPLE_RSS);
      const titles = movies.map(m => m.name);
      expect(titles).not.toContain('Over the Garden Wall');
    });

    it('returns empty array for feed with no watched entries', () => {
      const emptyFeed = `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`;
      expect(parseRssFeed(emptyFeed)).toEqual([]);
    });
  });

  describe('RssScraper.getMovies', () => {
    const mockFetch = jest.fn();

    beforeEach(() => {
      global.fetch = mockFetch;
      mockFetch.mockReset();
    });

    it('fetches and parses the RSS feed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => '"etag-abc"' },
        text: async () => SAMPLE_RSS,
      });

      const scraper = new RssScraper('https://letterboxd.com/testuser/films/');
      const result = await scraper.getMovies();

      expect(result).not.toBeNull();
      expect(result!.movies).toHaveLength(2);
      expect(result!.etag).toBe('"etag-abc"');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://letterboxd.com/testuser/rss/',
        { headers: {} }
      );
    });

    it('sends If-None-Match header when etag is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => '"etag-new"' },
        text: async () => SAMPLE_RSS,
      });

      const scraper = new RssScraper('https://letterboxd.com/testuser/films/');
      await scraper.getMovies('"etag-old"');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://letterboxd.com/testuser/rss/',
        { headers: { 'If-None-Match': '"etag-old"' } }
      );
    });

    it('returns null on 304 Not Modified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 304,
        headers: { get: () => null },
      });

      const scraper = new RssScraper('https://letterboxd.com/testuser/films/');
      const result = await scraper.getMovies('"etag-current"');

      expect(result).toBeNull();
    });

    it('throws on non-304 error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => null },
      });

      const scraper = new RssScraper('https://letterboxd.com/testuser/films/');
      await expect(scraper.getMovies()).rejects.toThrow('Failed to fetch RSS feed: 403');
    });
  });
});
