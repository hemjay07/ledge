/* Binary modules the bundler inlines. */
declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
