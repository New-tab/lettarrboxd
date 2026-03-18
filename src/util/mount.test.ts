import * as fsPromises from 'fs/promises';
import { mountSentinelExists } from './mount';

jest.mock('fs/promises', () => ({
  access: jest.fn(),
}));

describe('mountSentinelExists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns true when the sentinel exists', async () => {
    (fsPromises.access as jest.Mock).mockResolvedValueOnce(undefined);

    await expect(mountSentinelExists('/mnt/media/.MOUNT_OK')).resolves.toBe(true);
  });

  it('returns false when the sentinel is missing', async () => {
    (fsPromises.access as jest.Mock).mockRejectedValueOnce({ code: 'ENOENT' });

    await expect(mountSentinelExists('/mnt/media/.MOUNT_OK')).resolves.toBe(false);
  });

  it('rethrows unexpected filesystem errors', async () => {
    (fsPromises.access as jest.Mock).mockRejectedValueOnce(new Error('EACCES'));

    await expect(mountSentinelExists('/mnt/media/.MOUNT_OK')).rejects.toThrow('EACCES');
  });
});
