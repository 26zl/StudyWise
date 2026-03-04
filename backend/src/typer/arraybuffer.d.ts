/**
 * Polyfill type declarations for ArrayBuffer methods
 * added in ES2024 but missing from Node 20's lib types.
 * The actual polyfill lives in services/document.ts.
 */
interface ArrayBuffer {
    /**
     * Creates a new ArrayBuffer with the same byte content
     * and detaches this ArrayBuffer.
     */
    transfer(newByteLength?: number): ArrayBuffer;

    /**
     * Creates a new non-resizable ArrayBuffer with the same byte content
     * and detaches this ArrayBuffer.
     */
    transferToFixedLength(newByteLength?: number): ArrayBuffer;
}
