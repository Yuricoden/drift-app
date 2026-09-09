import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force';
import { useSignals, ResearchSignalState } from '../signals';
import { momentumLabel, signalAssociations, validIndustries } from '../../../shared/signals';
import { EvidenceList } from '../components/EvidenceList';
import { INDUSTRIES, industryName } from '../../../shared/catalog/industries';
import type { ExtractedSignal, SignalStage } from '../../../shared/types';
import { Chip, StageTag } from '../components/ui';

type Selected = { kind: 'domain' | 'signal'; id: string } | null;

interface DomainNode extends SimulationNodeDatum { kind: 'domain'; id: string; name: string }
interface SignalNode extends SimulationNodeDatum { kind: 'signal'; id: string; name: string; stage: SignalStage }
type MapNode = DomainNode | SignalNode;
type LinkDatum = SimulationLinkDatum<MapNode>;

interface MapHandle {
  highlight: (sel: { signal: string | null; domain: string | null }) => void;
  focus: (id: string) => void;
  destroy: () => void;
}

function MapFilterRow({ id, label, children }: { id: string; label: string; children: ComponentChildren }) {
  const viewport = useRef<HTMLDivElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const row = viewport.current;
    const content = items.current;
    if (!row || !content) return;
    const measure = () => {
      const left = row.scrollLeft > 1;
      const right = row.scrollWidth - row.clientWidth - row.scrollLeft > 1;
      setEdges(previous => previous.left === left && previous.right === right ? previous : { left, right });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(content);
    row.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); row.removeEventListener('scroll', measure); };
  }, []);

  const scroll = (direction: number) => {
    const row = viewport.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };

  return <div class="map-filter-row">
    <span class="map-filter-label mono" id={`${id}-label`}>{label}</span>
    <div class="map-filter-scroll">
      <button type="button" class="map-filter-arrow" aria-label={`Scroll ${label.toLowerCase()} left`} aria-controls={id} disabled={!edges.left} onClick={() => scroll(-1)}><span aria-hidden="true">←</span></button>
      <div ref={viewport} id={id} class="filters__row filters__row--scroll map-filter-viewport" role="group" aria-labelledby={`${id}-label`}>
        <div ref={items} class="map-filter-items">{children}</div>
      </div>
      <button type="button" class="map-filter-arrow" aria-label={`Scroll ${label.toLowerCase()} right`} aria-controls={id} disabled={!edges.right} onClick={() => scroll(1)}><span aria-hidden="true">→</span></button>
    </div>
  </div>;
}

export function SignalMapPage() {
  const { query } = useLocation();
  const { signals: SIGNALS } = useSignals();
  const signalById = (id: string) => SIGNALS.find(s => s.id === id);
  const initialSignal = typeof query.signal === 'string' ? query.signal : null;
  const [selected, setSelected] = useState<Selected>(initialSignal ? { kind: 'signal', id: initialSignal } : null);
  const [signalFilter, setSignalFilter] = useState<string | null>(initialSignal);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapHandle | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    mapRef.current = initMap(containerRef.current, setSelected, SIGNALS);
    return () => {
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, [SIGNALS]);

  useEffect(() => {
    mapRef.current?.highlight({ signal: signalFilter, domain: domainFilter });
  }, [signalFilter, domainFilter, SIGNALS]);

  useEffect(() => {
    if (selected) mapRef.current?.focus(selected.id);
  }, [selected, SIGNALS]);

  useEffect(() => {
    if (typeof query.signal === 'string') { setSelected({ kind: 'signal', id: query.signal }); setSignalFilter(query.signal); }
  }, [query.signal]);

  const selectedSignal = selected?.kind === 'signal' ? signalById(selected.id) : undefined;
  const selectedDomain = selected?.kind === 'domain' ? INDUSTRIES.find((i) => i.id === selected.id) : undefined;
  const domainSignals = selectedDomain ? SIGNALS.filter((s) => s.industries.includes(selectedDomain.id)) : [];

  return (
    <div class="page page--map">
      <div class="map-head">
        <div>
          <p class="page-head__tag mono">02 / Signal Map</p>
          <h1 class="page-head__title page-head__title--small">How signals <em>connect.</em></h1>
        </div>
        <div class="map-filters">
          <MapFilterRow id="map-signals" label="Signals">
            <Chip active={signalFilter === null} onClick={() => setSignalFilter(null)}>All signals</Chip>
            {SIGNALS.map((s) => (
              <Chip key={s.id} active={signalFilter === s.id} onClick={() => setSignalFilter(signalFilter === s.id ? null : s.id)}>{s.name}</Chip>
            ))}
          </MapFilterRow>
          <MapFilterRow id="map-domains" label="Domains">
            <Chip active={domainFilter === null} onClick={() => setDomainFilter(null)}>All domains</Chip>
            {INDUSTRIES.map((i) => (
              <Chip key={i.id} active={domainFilter === i.id} onClick={() => setDomainFilter(domainFilter === i.id ? null : i.id)}>{i.name}</Chip>
            ))}
          </MapFilterRow>
        </div>
      </div>
      <p class="map-context mono">AI-classified association · Undirected, not proven movement between industries</p>
      <ResearchSignalState />

      <div class="map-stage">
        <div class="map-canvas" ref={containerRef} role="application" aria-label="Interactive signal map. Scroll to zoom, drag to pan." />
        <p class="map-hint mono">Drag to pan · Scroll to zoom · Click a node</p>

        {selectedSignal && (
          <aside class="map-panel">
            <button type="button" class="map-panel__close" aria-label="Close panel" onClick={() => setSelected(null)}>✕</button>
            <p class="mono map-panel__tag">Signal S—{selectedSignal.serial}</p>
            <h2>{selectedSignal.name}</h2>
            <div class="map-panel__meta">
              <StageTag stage={selectedSignal.stage} />
              <span class="mono">{momentumLabel(selectedSignal)}</span>
            </div>
            <p>{selectedSignal.summary}</p>
            <p class="map-panel__path mono">{validIndustries(selectedSignal.industries).map(industryName).join(' · ') || 'Unclassified'}</p>
            <EvidenceList evidence={selectedSignal.evidence} />
            <div class="map-panel__actions">
              <a class="btn" href={`/app/signals/${selectedSignal.id}`}><span class="btn__text">Open signal</span><span class="btn__arrow">↗</span></a>
              <a class="btn" href={`/app/transfer?signal=${selectedSignal.id}`}><span class="btn__text">Transfer</span></a>
            </div>
          </aside>
        )}

        {selectedDomain && (
          <aside class="map-panel">
            <button type="button" class="map-panel__close" aria-label="Close panel" onClick={() => setSelected(null)}>✕</button>
            <p class="mono map-panel__tag">Domain</p>
            <h2>{selectedDomain.name}</h2>
            <p>Selectable industry taxonomy. Connections are AI-classified associations, not evidence of migration.</p>
            <p class="mono map-panel__tag">{domainSignals.length} signal{domainSignals.length === 1 ? '' : 's'} associated</p>
            <ul class="map-panel__signals">
              {domainSignals.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => { setSelected({ kind: 'signal', id: s.id }); setSignalFilter(s.id); }}>
                    {s.name} <span class="mono">{momentumLabel(s)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
function initMap(container: HTMLDivElement, onSelect: (sel: Selected) => void, SIGNALS: ExtractedSignal[]): MapHandle {
  const associations = signalAssociations(SIGNALS);
  const domains = new Set(associations.map(a => a.industryId));
  const domainNodes: DomainNode[] = INDUSTRIES.filter(i => domains.has(i.id)).map(i => ({ kind: 'domain', id: `industry:${i.id}`, name: i.name }));
  const signalNodes: SignalNode[] = SIGNALS.map(s => ({ kind: 'signal', id: s.id, name: s.name, stage: s.stage }));
  const allNodes: MapNode[] = [...domainNodes, ...signalNodes];
  const attachLinks: LinkDatum[] = associations.map(a => ({ source: a.signalId, target: `industry:${a.industryId}` }));
  const width = container.clientWidth || 960;
  const height = container.clientHeight || 620;

  const nodes: MapNode[] = allNodes.map((n) => ({ ...n }));
  const links: LinkDatum[] = attachLinks.map((l) => ({ ...l }));
  const byId = new Map<string, MapNode>(nodes.map((n) => [n.id, n]));

  const svg = select(container)
    .append('svg')
    .attr('class', 'map-svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`);

  const root = svg.append('g');
  const edgeLayer = root.append('g');
  const nodeLayer = root.append('g');

  const zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.45, 2.8])
    .on('zoom', (event: { transform: string }) => root.attr('transform', event.transform));
  svg.call(zoomBehavior);
  svg.call(
    zoomBehavior.transform,
    zoomIdentity.translate(width / 2, height / 2).scale(0.9).translate(-width / 2, -height / 2),
  );
  svg.on('click', () => onSelect(null));

  const attachSel = edgeLayer
    .selectAll<SVGLineElement, LinkDatum>('line.map-attach')
    .data(links)
    .join('line')
    .attr('class', 'map-attach');
  attachSel.append('title').text('AI-classified association');

  const nodeSel = nodeLayer
    .selectAll<SVGGElement, MapNode>('g.map-node')
    .data(nodes, (d) => d.id)
    .join('g')
    .attr('class', (d) => `map-node map-node--${d.kind}`)
    .attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => d.name)
    .on('keydown', (event, d) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ kind: d.kind, id: d.kind === 'domain' ? d.id.slice(9) : d.id }); } })
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation();
      onSelect({ kind: d.kind, id: d.kind === 'domain' ? d.id.slice(9) : d.id });
    })
    .on('mouseenter', (_event, d) => {
      hovered = d.id;
      applyState();
    })
    .on('mouseleave', () => {
      hovered = null;
      applyState();
    });

  nodeSel.filter((d) => d.kind === 'domain').append('circle').attr('r', 22).attr('class', 'map-node__halo');
  nodeSel.filter((d) => d.kind === 'domain').append('circle').attr('r', 5.5).attr('class', 'map-node__core');
  nodeSel.filter((d) => d.kind === 'signal').append('circle').attr('r', 5).attr('class', 'map-node__signal');
  nodeSel.filter((d) => d.kind === 'domain').append('text').attr('y', 36).attr('text-anchor', 'middle').attr('class', 'map-node__label').text((d) => d.name);
  nodeSel.filter((d) => d.kind === 'signal').append('text').attr('y', -11).attr('text-anchor', 'middle').attr('class', 'map-node__label map-node__label--signal').text((d) => d.name);

  const sim = forceSimulation<MapNode>(nodes)
    .force('charge', forceManyBody<MapNode>().strength((d) => (d.kind === 'domain' ? -460 : -24)))
    .force('link', forceLink<MapNode, LinkDatum>(links).id((d) => d.id).distance(92).strength(0.85))
    .force('collide', forceCollide<MapNode>((d) => (d.kind === 'domain' ? 64 : 30)))
    .force('x', forceX<MapNode>(width / 2).strength(0.05))
    .force('y', forceY<MapNode>(height / 2).strength(0.08))
    .alphaDecay(0.022)
    .on('tick', ticked);

  function ticked() {
    attachSel
      .attr('x1', (d) => (d.source as MapNode).x ?? 0)
      .attr('y1', (d) => (d.source as MapNode).y ?? 0)
      .attr('x2', (d) => (d.target as MapNode).x ?? 0)
      .attr('y2', (d) => (d.target as MapNode).y ?? 0);
    nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  }

  let hovered: string | null = null;
  let filter: { signal: string | null; domain: string | null } = { signal: null, domain: null };

  function activeSignals(): Set<string> | null {
    if (filter.signal) return new Set([filter.signal]);
    if (filter.domain) return new Set(SIGNALS.filter((s) => s.industries.includes(filter.domain!)).map((s) => s.id));
    if (hovered) {
      const node = byId.get(hovered);
      if (node?.kind === 'signal') return new Set([node.id]);
      if (node?.kind === 'domain') return new Set(SIGNALS.filter((s) => s.industries.includes(node.id.slice(9))).map((s) => s.id));
    }
    return null;
  }

  function applyState() {
    const active = activeSignals();
    attachSel.classed('is-dim', d => !!active && !active.has((d.source as MapNode).id));
    nodeSel
      .classed('is-dim', (d) => {
        if (!active) return false;
        if (d.kind === 'signal') return !active.has(d.id);
        return !SIGNALS.some((s) => active.has(s.id) && s.industries.includes(d.id.slice(9)));
      })
      .classed('is-focus', (d) => d.id === filter.signal || d.id === hovered);
  }

  // Settle the initial layout before applying a deep-link focus. Otherwise
  // the camera follows the initial origin while nodes move to the center.
  sim.stop().tick(200);
  ticked();
  applyState();
  const resize = new ResizeObserver(() => svg.attr('viewBox', `0 0 ${container.clientWidth || width} ${container.clientHeight || height}`));
  resize.observe(container);

  return {
    highlight(sel) {
      filter = sel;
      applyState();
    },
    focus(id) {
      const node = byId.get(id) ?? byId.get(`industry:${id}`);
      if (!node || node.x === undefined || node.y === undefined) return;
      svg.call(
        zoomBehavior.transform,
        zoomIdentity.translate(width / 2, height / 2).scale(1.25).translate(-node.x, -node.y),
      );
    },
    destroy() {
      resize.disconnect();
      sim.stop();
      svg.remove();
    },
  };
}
