// Ambient module declarations for Vite import suffixes used by the library.

declare module '*?worker&inline' {
  const WorkerFactory: new (options?: { name?: string }) => Worker;
  export default WorkerFactory;
}
