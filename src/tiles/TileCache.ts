// ============================================================================
// treelet.js - Tile Cache (LRU)
// ============================================================================

import type { TileCoord } from '../core/types';
import { DEFAULT_CACHE_SIZE } from '../core/constants';
import { tileKey, neighborTiles } from './TileIndex';
import type { Mesh } from 'three';

export interface CacheEntry {
  coord: TileCoord;
  mesh: Mesh;
  elevations?: Float32Array;
  lastAccessed: number;
}

/**
 * Doubly-linked list node for O(1) LRU eviction.
 */
interface LRUNode {
  key: string;
  prev: LRUNode | null;
  next: LRUNode | null;
}

/**
 * LRU cache for tile data (meshes, elevation arrays).
 *
 * When the cache exceeds maxEntries, the least-recently-accessed
 * entries are evicted first.
 *
 * Uses a doubly-linked list for O(1) LRU tracking and eviction.
 */
export class TileCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;

  /** Doubly-linked list for O(1) LRU eviction. Head = most recent, tail = least recent. */
  private readonly lruNodes = new Map<string, LRUNode>();
  private lruHead: LRUNode | null = null;
  private lruTail: LRUNode | null = null;

  /** Callback invoked when an entry is evicted (to dispose GPU resources). */
  onEvict: ((entry: CacheEntry) => void) | null = null;

  constructor(maxEntries: number = DEFAULT_CACHE_SIZE) {
    this.maxEntries = maxEntries;
  }

  /**
   * Store a tile in the cache.
   */
  set(coord: TileCoord, entry: Omit<CacheEntry, 'lastAccessed'>): void {
    const key = tileKey(coord);
    this.entries.set(key, {
      ...entry,
      lastAccessed: Date.now(),
    });
    this.touchLRU(key);
    this.evictIfNeeded();
  }

  /**
   * Retrieve a tile from the cache. Updates access time.
   */
  get(coord: TileCoord): CacheEntry | undefined {
    const key = tileKey(coord);
    const entry = this.entries.get(key);
    if (entry) {
      entry.lastAccessed = Date.now();
      this.touchLRU(key);
    }
    return entry;
  }

  /**
   * Check if a tile is cached.
   */
  has(coord: TileCoord): boolean {
    return this.entries.has(tileKey(coord));
  }

  /**
   * Check if a tile key string is cached (avoids recomputing tileKey).
   */
  hasKey(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Remove a specific tile from the cache.
   */
  delete(coord: TileCoord): CacheEntry | undefined {
    const key = tileKey(coord);
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.removeLRUNode(key);
    }
    return entry;
  }

  /**
   * Get elevation data for a tile's neighbors (for seam resolution).
   */
  getNeighborElevations(coord: TileCoord): {
    north?: Float32Array;
    south?: Float32Array;
    east?: Float32Array;
    west?: Float32Array;
  } {
    const neighbors = neighborTiles(coord);
    const result: Record<string, Float32Array | undefined> = {};

    if (neighbors.north) {
      result.north = this.entries.get(tileKey(neighbors.north))?.elevations;
    }
    if (neighbors.south) {
      result.south = this.entries.get(tileKey(neighbors.south))?.elevations;
    }
    result.east = this.entries.get(tileKey(neighbors.east))?.elevations;
    result.west = this.entries.get(tileKey(neighbors.west))?.elevations;

    return result;
  }

  /**
   * Iterate all cached entries without allocating an intermediate array.
   */
  *iterateEntries(): IterableIterator<CacheEntry> {
    yield* this.entries.values();
  }

  /**
   * Get all cached entries (for bulk operations like visual mode switching).
   * @deprecated Use iterateEntries() to avoid allocating an intermediate array.
   */
  getAllEntries(): CacheEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get current cache size.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    if (this.onEvict) {
      for (const entry of this.entries.values()) {
        this.onEvict(entry);
      }
    }
    this.entries.clear();
    this.lruNodes.clear();
    this.lruHead = null;
    this.lruTail = null;
  }

  // -- Private: LRU linked list management --

  /**
   * Move a key to the head (most recently used) of the LRU list.
   * Creates a new node if the key is not yet tracked.
   */
  private touchLRU(key: string): void {
    let node = this.lruNodes.get(key);
    if (node) {
      // Already exists - unlink from current position
      this.unlinkNode(node);
    } else {
      // New node
      node = { key, prev: null, next: null };
      this.lruNodes.set(key, node);
    }

    // Insert at head
    node.prev = null;
    node.next = this.lruHead;
    if (this.lruHead) {
      this.lruHead.prev = node;
    }
    this.lruHead = node;
    if (!this.lruTail) {
      this.lruTail = node;
    }
  }

  /**
   * Remove a key's node from the LRU list entirely.
   */
  private removeLRUNode(key: string): void {
    const node = this.lruNodes.get(key);
    if (!node) return;
    this.unlinkNode(node);
    this.lruNodes.delete(key);
  }

  /**
   * Unlink a node from the doubly-linked list without removing it from the Map.
   */
  private unlinkNode(node: LRUNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.lruHead = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.lruTail = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      this.evictLRU();
    }
  }

  /**
   * Evict the least recently used entry (tail of the linked list) in O(1).
   */
  private evictLRU(): void {
    if (!this.lruTail) return;

    const key = this.lruTail.key;
    const entry = this.entries.get(key);

    // Remove from LRU list
    this.unlinkNode(this.lruTail);
    this.lruNodes.delete(key);

    // Remove from entries map and notify
    if (entry) {
      if (this.onEvict) {
        this.onEvict(entry);
      }
      this.entries.delete(key);
    }
  }
}
