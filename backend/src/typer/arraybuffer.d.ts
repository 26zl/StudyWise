/**
 * Polyfill-typedeklarasjoner for ArrayBuffer-metoder
 * lagt til i ES2024 men mangler fra Node 20 sine lib-typer.
 * Selve polyfillen ligger i services/document.ts.
 */
interface ArrayBuffer {
  /**
   * Oppretter en ny ArrayBuffer med samme byte-innhold
   * og frakobler denne ArrayBufferen.
   */
  transfer(newByteLength?: number): ArrayBuffer;

  /**
   * Oppretter en ny ikke-resizerbar ArrayBuffer med samme byte-innhold
   * og frakobler denne ArrayBufferen.
   */
  transferToFixedLength(newByteLength?: number): ArrayBuffer;
}
