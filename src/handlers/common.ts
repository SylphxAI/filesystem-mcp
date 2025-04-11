export type FileSystemDependencies = {
  path: {
    resolve: (...paths: string[]) => string;
  };
  writeFile: (path: string, content: string, encoding: string) => Promise<void>;
  readFile: (path: string, encoding: string) => Promise<string>;
  projectRoot: string;
};
