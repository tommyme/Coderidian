// Re-export the pre-compiled transformers iframe connector from jsbrains.
// This is a self-contained JS bundle string that the LocalEmbeddingProvider
// injects into a hidden <iframe> to run transformers.js in isolation.
// Models are downloaded at runtime from HuggingFace CDN (first use only)
// and cached in IndexedDB.
export { transformers_connector } from '../../../../jsbrains/smart-embed-model/connectors/transformers_iframe.js';
