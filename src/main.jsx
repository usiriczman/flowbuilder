import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getSmoothStepPath,
  MarkerType,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FilePlus2, Info, Link, Plus, Tags, Trash2 } from 'lucide-react';
import { create } from 'zustand';
import './styles.css';

const createFlow = (index) => ({
  id: `flow-${Date.now()}-${index}`,
  name: `Flow ${index}`,
  nodes: [],
  edges: [],
});

const initialFlow = createFlow(1);

const arrowColorPresets = [
  '#111827',
  '#2563eb',
  '#0f766e',
  '#ea580c',
  '#be123c',
  '#7c3aed',
];
const minEdgeLabelPosition = 0.08;
const maxEdgeLabelPosition = 0.92;

function normalizeArrowStyle(value) {
  return value === 'solid' ? 'solid' : 'dash';
}

function encodeShareState(state) {
  const activeFlow =
    state.flows.find((flow) => flow.id === state.activeFlowId) ?? state.flows[0];
  const json = JSON.stringify({
    v: 1,
    a: activeFlow?.id,
    f: activeFlow
      ? [{
          i: activeFlow.id,
          n: activeFlow.name,
          ns: activeFlow.nodes,
          es: activeFlow.edges,
        }]
      : [],
  });

  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeShareState(value) {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const decoded = decodeURIComponent(escape(atob(padded)));
    const parsed = JSON.parse(decoded);
    const flows = parsed.f?.map((flow) => ({
      id: flow.i,
      name: flow.n,
      nodes: flow.ns ?? [],
      edges: flow.es ?? [],
    }));

    if (!flows?.length) return null;

    return {
      flows,
      activeFlowId: flows.some((flow) => flow.id === parsed.a) ? parsed.a : flows[0].id,
    };
  } catch {
    return null;
  }
}

function readShareState() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return decodeShareState(params.get('s') ?? '');
}

const urlState = readShareState();

const useEditorStore = create((set) => ({
  flows: urlState?.flows ?? [initialFlow],
  activeFlowId: urlState?.activeFlowId ?? initialFlow.id,
  selectedNodeId: null,
  selectedEdgeId: null,
  setFlows: (updater) =>
    set((state) => ({
      flows: typeof updater === 'function' ? updater(state.flows) : updater,
    })),
  setActiveFlowId: (activeFlowId) => set({ activeFlowId }),
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setSelectedEdgeId: (selectedEdgeId) => set({ selectedEdgeId }),
  updateEdgeData: (edgeId, patch) =>
    set((state) => ({
      flows: state.flows.map((flow) =>
        flow.id === state.activeFlowId
          ? {
              ...flow,
              edges: flow.edges.map((edge) =>
                edge.id === edgeId
                  ? { ...edge, data: { ...edge.data, ...patch } }
                  : edge,
              ),
            }
          : flow,
      ),
    })),
}));

function StateNode({ id, data, selected }) {
  return (
    <div
      className={['state-node', selected ? 'is-selected' : ''].join(' ')}
      style={{ '--node-accent': data.color }}
    >
      <Handle
        className="state-handle state-handle-target"
        id={`${id}-left-target`}
        position={Position.Left}
        type="target"
      />
      {data.isEnd && (
        <Handle
          className="state-handle"
          id={`${id}-left-source`}
          position={Position.Left}
          type="source"
        />
      )}
      {!data.isEnd && (
        <Handle
          className="state-handle"
          id={`${id}-right-source`}
          position={Position.Right}
          type="source"
        />
      )}

      <div className="node-title">{data.title || 'Untitled state'}</div>
      <div className="node-body">{data.body || 'Describe this state'}</div>
      {!!data.tags?.length && (
        <div className="tag-row">
          {data.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { stateNode: StateNode };

function textToTags(value) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function DraggableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  style,
  className,
  label,
  data,
}) {
  const updateEdgeData = useEditorStore((state) => state.updateEdgeData);
  const setSelectedEdgeId = useEditorStore((state) => state.setSelectedEdgeId);
  const setSelectedNodeId = useEditorStore((state) => state.setSelectedNodeId);
  const { screenToFlowPosition } = useReactFlow();
  const pathMeasureRef = useRef(null);
  const [labelPoint, setLabelPoint] = useState({ x: sourceX, y: sourceY });
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const labelPosition = Math.min(
    maxEdgeLabelPosition,
    Math.max(minEdgeLabelPosition, data?.labelPosition ?? 0.5),
  );
  const renderedLabel = typeof label === 'string' ? label.trim() : label;

  useLayoutEffect(() => {
    const path = pathMeasureRef.current;
    if (!path) return;

    const length = path.getTotalLength();
    const point = path.getPointAtLength(length * labelPosition);
    setLabelPoint({ x: point.x, y: point.y });
  }, [edgePath, labelPosition]);

  const startLabelDrag = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedEdgeId(id);
    setSelectedNodeId(null);

    const path = pathMeasureRef.current;
    if (!path) return;

    const pathLength = path.getTotalLength();
    if (!pathLength) return;

    const moveLabel = (moveEvent) => {
      const pointer = screenToFlowPosition({
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });
      let nearestPosition = labelPosition;
      let nearestDistance = Infinity;
      const samples = 96;

      for (let index = 0; index <= samples; index += 1) {
        const position =
          minEdgeLabelPosition +
          ((maxEdgeLabelPosition - minEdgeLabelPosition) * index) / samples;
        const point = path.getPointAtLength(pathLength * position);
        const distance = (point.x - pointer.x) ** 2 + (point.y - pointer.y) ** 2;

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPosition = position;
        }
      }

      updateEdgeData(id, {
        labelPosition: nearestPosition,
      });
    };

    const stopLabelDrag = () => {
      window.removeEventListener('pointermove', moveLabel);
      window.removeEventListener('pointerup', stopLabelDrag);
    };

    window.addEventListener('pointermove', moveLabel);
    window.addEventListener('pointerup', stopLabelDrag);
  };

  return (
    <>
      <BaseEdge
        className={className}
        markerEnd={markerEnd}
        markerStart={markerStart}
        path={edgePath}
        style={style}
      />
      <path
        ref={pathMeasureRef}
        d={edgePath}
        fill="none"
        opacity="0"
        pointerEvents="none"
      />
      {renderedLabel && (
        <EdgeLabelRenderer>
          <button
            className="edge-label-drag"
            onPointerDown={startLabelDrag}
            style={{
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
            }}
          >
            {renderedLabel}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { draggableEdge: DraggableEdge };

function App() {
  const flows = useEditorStore((state) => state.flows);
  const activeFlowId = useEditorStore((state) => state.activeFlowId);
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId);
  const setFlows = useEditorStore((state) => state.setFlows);
  const setActiveFlowId = useEditorStore((state) => state.setActiveFlowId);
  const setSelectedNodeId = useEditorStore((state) => state.setSelectedNodeId);
  const setSelectedEdgeId = useEditorStore((state) => state.setSelectedEdgeId);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [addFeedback, setAddFeedback] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  const activeFlow = flows.find((flow) => flow.id === activeFlowId) ?? flows[0];
  const nodes = activeFlow?.nodes ?? [];
  const edges = activeFlow?.edges ?? [];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId);

  useEffect(() => {
    const encoded = encodeShareState({ flows, activeFlowId });
    const nextUrl = `${window.location.pathname}${window.location.search}#s=${encoded}`;

    window.history.replaceState(null, '', nextUrl);
  }, [flows, activeFlowId]);

  useEffect(() => {
    setTagDraft('');
  }, [selectedNodeId]);

  const updateActiveFlow = useCallback((patcher) => {
    setFlows((current) =>
      current.map((flow) =>
        flow.id === activeFlowId ? { ...flow, ...patcher(flow) } : flow,
      ),
    );
  }, [activeFlowId]);

  const styledEdges = useMemo(
    () =>
      edges.map((edge) => {
        const edgeStyle = edge.data?.style || normalizeArrowStyle(edge.data?.animation);
        const shouldAnimate = edgeStyle === 'dash' && edge.data?.animate !== false;

        return {
          ...edge,
          animated: false,
          type: 'draggableEdge',
          className: [
            `edge-style-${edgeStyle}`,
            shouldAnimate ? 'edge-dash-animated' : '',
          ].join(' '),
          style: {
            stroke: edge.data?.color || '#111827',
          },
          markerStart: edge.data?.direction === 'reverse'
            ? { type: MarkerType.ArrowClosed, color: edge.data?.color || '#111827' }
            : undefined,
          markerEnd: edge.data?.direction === 'reverse'
            ? undefined
            : { type: MarkerType.ArrowClosed, color: edge.data?.color || '#111827' },
        };
      }),
    [edges],
  );

  const setNodesForActiveFlow = useCallback((updater) => {
    updateActiveFlow((flow) => ({
      nodes: typeof updater === 'function' ? updater(flow.nodes) : updater,
    }));
  }, [updateActiveFlow]);

  const setEdgesForActiveFlow = useCallback((updater) => {
    updateActiveFlow((flow) => ({
      edges: typeof updater === 'function' ? updater(flow.edges) : updater,
    }));
  }, [updateActiveFlow]);

  const getSourceHandle = useCallback((nodeId) => {
    const node = nodes.find((item) => item.id === nodeId);
    return node?.data.isEnd ? `${nodeId}-left-source` : `${nodeId}-right-source`;
  }, [nodes]);

  const getTargetHandle = useCallback((nodeId) => `${nodeId}-left-target`, []);

  const onNodesChange = useCallback((changes) => {
    setNodesForActiveFlow((current) => applyNodeChanges(changes, current));
  }, [setNodesForActiveFlow]);

  const onEdgesChange = useCallback((changes) => {
    setEdgesForActiveFlow((current) => applyEdgeChanges(changes, current));
  }, [nodes, setEdgesForActiveFlow]);

  const onConnect = useCallback((connection) => {
    setEdgesForActiveFlow((current) =>
      addEdge(
        {
          ...connection,
          id: `${connection.source}-${connection.target}-${Date.now()}`,
          label: 'EVENT',
          type: 'draggableEdge',
          sourceHandle: connection.sourceHandle ?? getSourceHandle(connection.source),
          targetHandle: connection.targetHandle ?? getTargetHandle(connection.target),
          data: {
            style: 'dash',
            animate: true,
            color: '#111827',
            originalSource: connection.source,
            originalTarget: connection.target,
            direction: 'forward',
          },
        },
        current,
      ),
    );
  }, [getSourceHandle, getTargetHandle, setEdgesForActiveFlow]);

  const addFlow = () => {
    const nextFlow = createFlow(flows.length + 1);
    setFlows((current) => [...current, nextFlow]);
    setActiveFlowId(nextFlow.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  const selectFlow = (flowId) => {
    setActiveFlowId(flowId);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  };

  const copyShareUrl = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopyFeedback(true);
    window.setTimeout(() => setCopyFeedback(false), 900);
  };

  const addNode = (template = {}) => {
    const id = `state-${Date.now()}`;
    const nextNode = {
      id,
      type: 'stateNode',
      position: { x: 180 + nodes.length * 36, y: 160 + nodes.length * 28 },
      data: {
        title: template.title ?? `State ${nodes.length + 1}`,
        body: template.body ?? 'Define this state',
        tags: template.tags ?? [],
        info: template.info ?? '',
        isEnd: template.isEnd ?? false,
        color: template.color ?? '#ffffff',
        arrowStyle: 'dash',
        arrowAnimate: true,
      },
    };

    setNodesForActiveFlow((current) => [...current, nextNode]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setAddFeedback(true);
    window.setTimeout(() => setAddFeedback(false), 650);
  };

  const updateNodeData = useCallback((patch) => {
    setNodesForActiveFlow((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...patch } }
          : node,
      ),
    );

    if (patch.isEnd !== true || !selectedNodeId) return;

    setEdgesForActiveFlow((current) =>
      current.filter(
        (edge) =>
          !(
            edge.source === selectedNodeId &&
            edge.sourceHandle === `${selectedNodeId}-right-source`
          ),
      ),
    );
    setSelectedEdgeId(null);
  }, [selectedNodeId, setEdgesForActiveFlow, setNodesForActiveFlow, setSelectedEdgeId]);

  const updateSelectedEdge = useCallback((patch) => {
    setEdgesForActiveFlow((current) =>
      current.map((edge) =>
        edge.id === selectedEdgeId
          ? {
              ...edge,
              ...patch,
              data: { ...edge.data, ...(patch.data || {}) },
            }
          : edge,
      ),
    );
  }, [selectedEdgeId, setEdgesForActiveFlow]);

  const addTagsToSelectedNode = (value) => {
    if (!selectedNode) return;

    const nextTags = textToTags(value);
    if (!nextTags.length) return;

    updateNodeData({
      tags: Array.from(new Set([...(selectedNode.data.tags || []), ...nextTags])),
    });
  };

  const removeTagFromSelectedNode = (tagToRemove) => {
    if (!selectedNode) return;

    updateNodeData({
      tags: (selectedNode.data.tags || []).filter((tag) => tag !== tagToRemove),
    });
  };

  const updateTagDraft = (value) => {
    if (value.includes(',')) {
      const parts = value.split(',');
      addTagsToSelectedNode(parts.slice(0, -1).join(','));
      setTagDraft(parts.at(-1) ?? '');
      return;
    }

    setTagDraft(value);
  };

  const handleTagKeyDown = (event) => {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    addTagsToSelectedNode(tagDraft);
    setTagDraft('');
  };

  const setSelectedEdgeDirection = (direction) => {
    if (!selectedEdge) return;

    setEdgesForActiveFlow((current) =>
      current.map((edge) =>
        edge.id === selectedEdge.id
          ? {
              ...edge,
              data: {
                ...edge.data,
                originalSource: edge.data?.originalSource ?? edge.source,
                originalTarget: edge.data?.originalTarget ?? edge.target,
                direction,
              },
            }
          : edge,
      ),
    );
  };

  const updateOutgoingTransitions = (patch) => {
    if (!selectedNode) return;

    updateNodeData(patch);
    setEdgesForActiveFlow((current) =>
      current.map((edge) =>
        edge.source === selectedNode.id
          ? {
              ...edge,
              data: {
                ...edge.data,
                style: patch.arrowStyle ?? edge.data?.style,
                animate: patch.arrowStyle === 'solid'
                  ? false
                  : patch.arrowAnimate ?? edge.data?.animate ?? true,
              },
            }
          : edge,
      ),
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) return;

    setNodesForActiveFlow((current) =>
      current.filter((node) => node.id !== selectedNode.id),
    );
    setEdgesForActiveFlow((current) =>
      current.filter(
        (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
    );
    setSelectedNodeId(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">Flowbuilder</div>
        <nav className="flow-tabs" aria-label="Flows">
          {flows.map((flow) => (
            <button
              className={flow.id === activeFlowId ? 'active' : ''}
              key={flow.id}
              onClick={() => selectFlow(flow.id)}
            >
              {flow.name}
            </button>
          ))}
          <button className="icon-button" onClick={addFlow} aria-label="Create flow">
            <FilePlus2 size={15} />
          </button>
        </nav>
      </header>

      <section className="editor-grid">
        <section className="canvas-wrap">
          <button
            className={['canvas-add-button', addFeedback ? 'did-add' : ''].join(' ')}
            onClick={() => addNode()}
          >
            <Plus size={15} /> Add node
          </button>
          <ReactFlow
            fitView
            nodes={nodes}
            edges={styledEdges}
            edgeTypes={edgeTypes}
            nodeTypes={nodeTypes}
            onConnect={onConnect}
            onEdgesChange={onEdgesChange}
            onNodesChange={onNodesChange}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
          >
            <Background color="#d1d5db" gap={20} size={1} />
            <MiniMap
              maskColor="rgba(249, 250, 251, 0.78)"
              nodeColor={(node) => node.data.color || '#ffffff'}
              pannable
              zoomable
            />
            <Controls />
          </ReactFlow>
          {!nodes.length && (
            <div className="canvas-empty">
              <strong>Empty flow</strong>
              <span>Add a node from the canvas.</span>
            </div>
          )}
        </section>

        <aside className="side-panel inspector">
          <div className="panel-actions">
            <button
              className={['panel-share-button', copyFeedback ? 'did-copy' : ''].join(' ')}
              onClick={copyShareUrl}
            >
              <Link size={13} /> {copyFeedback ? 'Copied' : 'Copy share URL'}
            </button>
          </div>
          <div className="panel-heading">
            <span>Node properties</span>
          </div>

          {selectedNode && (
            <div className="panel-stack">
              <label>
                <span>Text</span>
                <input
                  value={selectedNode.data.title}
                  onChange={(event) => updateNodeData({ title: event.target.value })}
                />
              </label>
              <label className="switch-row end-node-row">
                <span>End node</span>
                <input
                  type="checkbox"
                  checked={selectedNode.data.isEnd}
                  onChange={(event) => updateNodeData({ isEnd: event.target.checked })}
                />
              </label>
              <label>
                <span>Description</span>
                <textarea
                  rows="3"
                  value={selectedNode.data.body}
                  onChange={(event) => updateNodeData({ body: event.target.value })}
                />
              </label>
              <label>
                <span><Info size={13} /> Additional info</span>
                <textarea
                  rows="4"
                  value={selectedNode.data.info}
                  onChange={(event) => updateNodeData({ info: event.target.value })}
                />
              </label>
              <label>
                <span><Tags size={13} /> Tags</span>
                <div className="tag-input">
                  {(selectedNode.data.tags || []).map((tag) => (
                    <span className="tag-chip" key={tag}>
                      {tag}
                      <button
                        aria-label={`Remove ${tag}`}
                        onClick={() => removeTagFromSelectedNode(tag)}
                        type="button"
                      >
                        x
                      </button>
                    </span>
                  ))}
                  <input
                    placeholder="Type tag, comma or Enter"
                    value={tagDraft}
                    onChange={(event) => updateTagDraft(event.target.value)}
                    onKeyDown={handleTagKeyDown}
                  />
                </div>
              </label>
              <div className="field-grid">
                <label>
                  <span>Fill</span>
                  <input
                    className="color-input"
                    type="color"
                    value={selectedNode.data.color}
                    onChange={(event) => updateNodeData({ color: event.target.value })}
                  />
                </label>
              </div>

              <div className="control-group">
                <span className="group-label">Outgoing arrows</span>
                <select
                  value={selectedNode.data.arrowStyle || normalizeArrowStyle(selectedNode.data.arrowAnimation)}
                  onChange={(event) =>
                    updateOutgoingTransitions({
                      arrowStyle: event.target.value,
                      arrowAnimate: event.target.value === 'dash'
                        ? selectedNode.data.arrowAnimate !== false
                        : false,
                    })
                  }
                >
                  <option value="dash">Dash</option>
                  <option value="solid">Solid</option>
                </select>
              </div>
              {(selectedNode.data.arrowStyle || normalizeArrowStyle(selectedNode.data.arrowAnimation)) === 'dash' && (
                <label className="switch-row">
                  <span>Animate dash</span>
                  <input
                    type="checkbox"
                    checked={selectedNode.data.arrowAnimate !== false}
                    onChange={(event) =>
                      updateOutgoingTransitions({ arrowAnimate: event.target.checked })
                    }
                  />
                </label>
              )}

              <button className="danger-action" onClick={deleteSelectedNode}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          )}

          {selectedEdge && (
            <div className="panel-stack">
              <label>
                <span>Transition label</span>
                <input
                  value={selectedEdge.label || ''}
                  onChange={(event) => updateSelectedEdge({ label: event.target.value })}
                />
              </label>
              <div className="control-group">
                <span className="group-label">Direction</span>
                <div className="radio-group">
                  <label>
                    <input
                      type="radio"
                      name="edge-direction"
                      checked={(selectedEdge.data?.direction || 'forward') === 'forward'}
                      onChange={() => setSelectedEdgeDirection('forward')}
                    />
                    Forward
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="edge-direction"
                      checked={selectedEdge.data?.direction === 'reverse'}
                      onChange={() => setSelectedEdgeDirection('reverse')}
                    />
                    Reverse
                  </label>
                </div>
              </div>
              <label>
                <span>Arrow style</span>
                <select
                  value={selectedEdge.data?.style || normalizeArrowStyle(selectedEdge.data?.animation)}
                  onChange={(event) =>
                    updateSelectedEdge({
                      data: {
                        style: event.target.value,
                        animate: event.target.value === 'dash',
                      },
                    })
                  }
                >
                  <option value="dash">Dash</option>
                  <option value="solid">Solid</option>
                </select>
              </label>
              {(selectedEdge.data?.style || normalizeArrowStyle(selectedEdge.data?.animation)) === 'dash' && (
                <label className="switch-row">
                  <span>Animate dash</span>
                  <input
                    type="checkbox"
                    checked={selectedEdge.data?.animate !== false}
                    onChange={(event) =>
                      updateSelectedEdge({ data: { animate: event.target.checked } })
                    }
                  />
                </label>
              )}
              <div className="control-group">
                <span className="group-label">Arrow color</span>
                <div className="color-presets">
                  {arrowColorPresets.map((color) => (
                    <button
                      aria-label={`Set arrow color ${color}`}
                      className={(selectedEdge.data?.color || '#111827') === color ? 'active' : ''}
                      key={color}
                      onClick={() => updateSelectedEdge({ data: { color } })}
                      style={{ '--preset-color': color }}
                      type="button"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {!selectedNode && !selectedEdge && (
            <div className="empty-state">
              Select a node or arrow to edit its properties.
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
