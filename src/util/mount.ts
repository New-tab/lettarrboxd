import { constants } from 'fs';
import { access } from 'fs/promises';

export async function mountSentinelExists(sentinelPath: string): Promise<boolean> {
  try {
    await access(sentinelPath, constants.F_OK);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}
