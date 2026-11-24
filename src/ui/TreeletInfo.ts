// ============================================================================
// treelet.js - TreeletInfo Web Component
//
// <treelet-info> - the info box (Ring i). It opens into a column with two
// pages and the map's credits at its foot:
//
//   Legend - the legends of the visible analyses (<treelet-legend>) and
//            the terrain under the pointer (<treelet-readout>)
//   Map    - the view (zoom, tiles, pitch, bearing) and its center and
//            extent, copied as EPSG:4326 or EPSG:3857 coordinates
//
// The page buttons sit on the rail by the box's corner (Map above Legend);
// the box's icon at the rail's far end closes the column.
// ============================================================================

import { BaseElement, escapeHtml } from './dom';
import { DockFrame } from './dock';
import { INFO_SVG, INFO_RAIL_SVG, LEGEND_SVG, MAP_SVG, COPY_SVG } from './icons';
import { WebMercator } from '../crs/WebMercator';
import type { TreeletLegend } from './TreeletLegend';
import type { TreeletReadout } from './TreeletReadout';
import type { TreeletAttribution } from './TreeletAttribution';
import type { Treelet } from '../core/Treelet';
import type { UICorner } from '../core/types';
import type { CameraState } from '../scene/CameraController';

/** Pages of the info column. */
export type InfoPage = 'legend' | 'map';

/** A bearing in [0, 360) with one decimal (rounded first: -0.04° is 0.0°, not 360.0°). */
function formatBearing(rotation: number): string {
  const tenths = Math.round(rotation * 10);
  return `${((((tenths % 3600) + 3600) % 3600) / 10).toFixed(1)}°`;
}

function copyButtons(what: 'center' | 'extent', shape: string): string {
  const crs = [['4326', 'EPSG:4326', shape], ['3857', 'Web Mercator', shape.replace(/lng, lat/g, 'x, y').replace(/west, south/g, 'minX, minY').replace(/east, north/g, 'maxX, maxY')]];
  return `<div class="seg" role="group" aria-label="Copy the ${what}">${crs.map(([code, name, s]) =>
    `<button type="button" data-copy="${what}-${code}" aria-label="Copy ${what} as EPSG:${code}" title="Copy ${what} as ${escapeHtml(name)} ${escapeHtml(s)}">${COPY_SVG}${code}</button>`,
  ).join('')}</div>`;
}

const MAP_PAGE = `
  <div class="grp"><span class="t">View</span></div>
  <div class="pair"><span><span class="k">Zoom</span><span class="v" data-stat="zoom">–</span></span><span><span class="k">Tiles</span><span class="v" data-stat="tiles">–</span></span></div>
  <div class="pair"><span><span class="k">Pitch</span><span class="v" data-stat="pitch">–</span></span><span><span class="k">Bearing</span><span class="v" data-stat="bearing">–</span></span></div>
  <div class="grp"><span class="t">Center</span></div>
  <div class="row flush"><span class="v" data-stat="center" style="margin-left: 0">–</span>${copyButtons('center', '[lng, lat]')}</div>
  <div class="grp"><span class="t">Extent</span></div>
  <div class="row flush"><span class="k">View bounds</span>${copyButtons('extent', '[[west, south], [east, north]]')}</div>
`;

export class TreeletInfo extends BaseElement {
  private shadow: ShadowRoot;
  private map: Treelet | null = null;
  private dock: DockFrame | null = null;
  private legend: TreeletLegend | null = null;
  private readout: TreeletReadout | null = null;
  private credits: TreeletAttribution | null = null;
  private camera: CameraState | null = null;
  private tiles = -1;
  private stats = new Map<string, HTMLElement>();
  private wasOpen = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  /**
   * Attach to a map and build the column.
   *
   * @param options.corner  - corner of the box (default 'bottom-left')
   * @param options.readout - show the terrain under the pointer on the Legend page (default true)
   * @param options.glass   - frosted surfaces
   */
  attach(map: Treelet, options: { corner?: UICorner; readout?: boolean; glass?: boolean } = {}): void {
    this.map = map;
    this.toggleAttribute('glass', options.glass === true);
    const glass = { glass: options.glass === true };
    // The pages are built once; with or without the readout now, they are built again
    if (this.dock && (options.readout !== false) !== (this.readout !== null)) this.rebuild();
    if (!this.dock) {
      this.dock = new DockFrame(this, this.shadow, {
        label: 'Legend and map',
        boxIcon: INFO_SVG,
        railIcon: INFO_RAIL_SVG,
        pages: [
          { id: 'map', label: 'Map', icon: MAP_SVG },
          { id: 'legend', label: 'Legend', icon: LEGEND_SVG },
        ],
        footer: true,
      }, (open, page) => this.onDockChange(open, page));

      this.legend = document.createElement('treelet-legend') as TreeletLegend;
      this.dock.pageEl('legend').appendChild(this.legend);
      if (options.readout !== false) {
        this.readout = document.createElement('treelet-readout') as TreeletReadout;
        this.dock.pageEl('legend').appendChild(this.readout);
      }
      const mapPage = this.dock.pageEl('map');
      mapPage.innerHTML = MAP_PAGE;
      mapPage.querySelectorAll<HTMLElement>('[data-stat]').forEach((el) => this.stats.set(el.dataset.stat!, el));
      mapPage.addEventListener('click', this.onCopy);

      this.credits = document.createElement('treelet-attribution') as TreeletAttribution;
      this.dock.foot!.appendChild(this.credits);
    }
    this.dock.place(options.corner ?? 'bottom-left');
    this.legend!.attach(map, glass);
    this.readout?.attach(map, glass);
    this.credits!.attach(map, undefined, glass);
    // Sampling and legends only while the Legend page is shown (also when attached again while it is)
    const shown = this.isOpen && this.page === 'legend';
    if (this.readout) this.readout.active = shown;
    this.legend!.active = shown;
  }

  /** Open the column, on `page` or the page shown last. */
  open(page?: InfoPage): void {
    this.dock?.open(page);
  }

  /** Close the column back into its box. */
  close(): void {
    this.dock?.close();
  }

  /** Whether the column is open. */
  get isOpen(): boolean {
    return this.dock?.isOpen ?? false;
  }

  /** The page shown (or shown last). */
  get page(): InfoPage {
    return (this.dock?.page ?? 'legend') as InfoPage;
  }

  /** Called on every camera change (shown on the Map page). */
  updateCamera(state: CameraState): void {
    this.camera = state;
    if (this.mapShown()) this.renderView();
  }

  /** Called every rendered frame (tiles load while the camera rests). */
  updateTileCount(count: number): void {
    if (count === this.tiles) return;
    this.tiles = count;
    if (this.mapShown()) {
      const el = this.stats.get('tiles');
      if (el) el.textContent = String(count);
    }
  }

  private mapShown(): boolean {
    return !!this.dock?.isOpen && this.dock.page === 'map';
  }

  /** Drop the column and its pages (the next attach builds them again). */
  private rebuild(): void {
    if (this.wasOpen) {
      this.wasOpen = false;
      this.dispatchEvent(new Event('close'));
    }
    this.dock = null;
    this.legend = null;
    this.readout = null;
    this.credits = null;
    this.stats.clear();
    this.shadow.innerHTML = '';
  }

  private onDockChange(open: boolean, page: string): void {
    if (this.readout) this.readout.active = open && page === 'legend';
    if (this.legend) this.legend.active = open && page === 'legend';
    if (open && page === 'map') this.renderView();
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      this.dispatchEvent(new Event(open ? 'open' : 'close'));
    }
  }

  private renderView(): void {
    const s = this.camera;
    const set = (key: string, text: string) => {
      const el = this.stats.get(key);
      if (el && el.textContent !== text) el.textContent = text;
    };
    if (s) {
      set('zoom', s.zoom.toFixed(1));
      set('pitch', `${(90 - s.pitch).toFixed(1)}°`);
      set('bearing', formatBearing(s.rotation));
    }
    if (this.tiles >= 0) set('tiles', String(this.tiles));
    const c = this.map?.getCenter();
    if (c) set('center', `${c.lng.toFixed(3)}, ${c.lat.toFixed(3)}`);
  }

  // =========================================================================
  // Copying the center and the extent
  // =========================================================================

  private onCopy = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
    if (!btn || !this.map) return;
    e.stopPropagation();
    const text = this.coordinates(btn.dataset.copy!);
    // The Clipboard API is unavailable on insecure origins; fail quietly
    navigator.clipboard?.writeText(text).then(() => {
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 800);
    }).catch(() => {});
  };

  /** JSON coordinates of the center or the extent, in EPSG:4326 or EPSG:3857. */
  private coordinates(what: string): string {
    const map = this.map!;
    const merc = what.endsWith('3857');
    if (what.startsWith('center')) {
      const c = map.getCenter();
      if (!merc) return JSON.stringify([+c.lng.toFixed(6), +c.lat.toFixed(6)]);
      const m = WebMercator.project(c);
      return JSON.stringify([+m.x.toFixed(2), +m.y.toFixed(2)]);
    }
    const b = map.getBounds();
    if (!b) return '[]';
    if (!merc) {
      return JSON.stringify([[+b.sw.lng.toFixed(6), +b.sw.lat.toFixed(6)], [+b.ne.lng.toFixed(6), +b.ne.lat.toFixed(6)]]);
    }
    const sw = WebMercator.project(b.sw);
    const ne = WebMercator.project(b.ne);
    return JSON.stringify([[+sw.x.toFixed(2), +sw.y.toFixed(2)], [+ne.x.toFixed(2), +ne.y.toFixed(2)]]);
  }
}
