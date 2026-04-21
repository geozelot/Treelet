// Type declarations for raw GLSL file imports (Vite ?raw suffix)
declare module '*.glsl?raw' {
  const source: string;
  export default source;
}
