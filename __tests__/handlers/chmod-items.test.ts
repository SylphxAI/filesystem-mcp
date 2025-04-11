import { vi, describe, it, expect, beforeEach } from 'vitest';

// 設置模擬模塊
vi.mock('node:fs', () => ({
  promises: {
    chmod: vi.fn().mockName('fs.chmod')
  }
}));

vi.mock('../../src/utils/path-utils', () => ({
  resolvePath: vi.fn().mockImplementation((path) =>
    `/project-root/${path}`
  ).mockName('pathUtils.resolvePath'),
  PROJECT_ROOT: '/project-root'
}));

describe('chmod-items handler', () => {
  let handler: any;
  let fsMock: any;
  let pathUtilsMock: any;

  beforeEach(async () => {
    // 動態導入模擬模塊
    fsMock = (await import('node:fs')).promises;
    pathUtilsMock = await import('../../src/utils/path-utils');
    
    // 重置模擬
    vi.resetAllMocks();
    
    // 設置默認模擬實現
    pathUtilsMock.resolvePath.mockImplementation((path: string) => 
      `/project-root/${path}`
    );
    fsMock.chmod.mockResolvedValue(undefined);
    
    // 動態導入處理程序
    const { chmodItemsToolDefinition } = await import('../../src/handlers/chmod-items');
    handler = chmodItemsToolDefinition.handler;
  });

  it('should change permissions for valid paths', async () => {
    const result = await handler({
      paths: ['file1.txt', 'dir/file2.txt'],
      mode: '755'
    });

    expect(fsMock.chmod).toHaveBeenCalledTimes(2);
    expect(JSON.parse(result.content[0].text)).toEqual([
      { path: 'file1.txt', mode: '755', success: true },
      { path: 'dir/file2.txt', mode: '755', success: true }
    ]);
  });

  it('should handle multiple operations with mixed results', async () => {
    fsMock.chmod
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: 'EPERM' });

    const result = await handler({
      paths: ['file1.txt', 'file2.txt'],
      mode: '755'
    });

    const output = JSON.parse(result.content[0].text);
    expect(output[0].success).toBe(true);
    expect(output[1].success).toBe(false);
  });
});