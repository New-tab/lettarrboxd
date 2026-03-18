import env from '../util/env';
import logger from '../util/logger';

interface FlareSolverrResponse {
  status: string;
  solution: {
    response: string;
    status: number;
  };
}

async function fetchViaFlareSolverr(url: string, baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cmd: 'request.get',
      url,
      maxTimeout: 60000
    })
  });

  if (!response.ok) {
    throw new Error(`FlareSolverr request failed: ${response.status}`);
  }

  const data = await response.json() as FlareSolverrResponse;

  if (data.status !== 'ok') {
    throw new Error(`FlareSolverr returned status: ${data.status}`);
  }

  if (data.solution.status === 403) {
    throw new Error(`FlareSolverr solved challenge but got 403 from target`);
  }

  return data.solution.response;
}

export async function fetchWithCloudflareFallback(url: string): Promise<string> {
  if (env.FLARESOLVERR_URL) {
    try {
      logger.debug(`Trying FlareSolverr for ${url}`);
      return await fetchViaFlareSolverr(url, env.FLARESOLVERR_URL);
    } catch (err) {
      logger.warn({ err }, 'FlareSolverr failed, trying Byparr');
    }
  }

  if (env.BYPARR_URL) {
    try {
      logger.debug(`Trying Byparr for ${url}`);
      return await fetchViaFlareSolverr(url, env.BYPARR_URL);
    } catch (err) {
      logger.warn({ err }, 'Byparr failed');
    }
  }

  throw new Error(`Could not fetch ${url} via FlareSolverr or Byparr`);
}
