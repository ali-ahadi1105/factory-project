import { Injectable } from '@nestjs/common';
import { FactoryStoreService } from '../store';
import { LineageGraph, LineageEdge } from '../core';

@Injectable()
export class LineageService {
  constructor(private readonly store: FactoryStoreService) {}

  getLineage(rootRef: string): LineageGraph {
    return this.store.getLineageGraph(rootRef);
  }

  formatAsciiTree(rootRef: string): string {
    const graph = this.store.getLineageGraph(rootRef);
    if (!graph.nodes.length) {
      return `(Empty lineage for ${rootRef})`;
    }

    const lines: string[] = [];
    lines.push(`📦 Root: ${rootRef}`);

    const edgeMap = new Map<string, LineageEdge[]>();
    for (const edge of graph.edges) {
      if (!edgeMap.has(edge.from)) {
        edgeMap.set(edge.from, []);
      }
      edgeMap.get(edge.from)!.push(edge);
    }

    const visited = new Set<string>();

    const printSubtree = (current: string, prefix = '') => {
      visited.add(current);
      const outgoing = edgeMap.get(current) || [];

      for (let i = 0; i < outgoing.length; i++) {
        const edge = outgoing[i];
        const isLast = i === outgoing.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        lines.push(`${prefix}${branch}[${edge.relationType}] ──► ${edge.to}`);
        if (!visited.has(edge.to)) {
          printSubtree(edge.to, prefix + (isLast ? '    ' : '│   '));
        }
      }
    };

    printSubtree(rootRef);
    return lines.join('\n');
  }
}
