import type { RouteMatch } from 'rxjs-router';

/** One activated level of the matched route branch. */
export interface ActivatedRouteNode<TMatch extends RouteMatch = RouteMatch> {
  readonly depth: number;
  readonly match: TMatch;
  readonly parent?: ActivatedRouteNode<TMatch>;
  readonly child?: ActivatedRouteNode<TMatch>;
}

/**
 * A named structure over router.state.matches[].
 *
 * M14 keeps rxjs-router's flat ordered matches array intact, but names the
 * parent-to-child activation structure that RouterOutlet consumes.
 */
export interface ActivatedRouteTree<TMatch extends RouteMatch = RouteMatch> {
  readonly root?: ActivatedRouteNode<TMatch>;
  readonly leaf?: ActivatedRouteNode<TMatch>;
  readonly branch: readonly ActivatedRouteNode<TMatch>[];
}

type MutableActivatedRouteNode<TMatch extends RouteMatch> = {
  depth: number;
  match: TMatch;
  parent?: MutableActivatedRouteNode<TMatch>;
  child?: MutableActivatedRouteNode<TMatch>;
};

export const createActivatedRouteTree = <TMatch extends RouteMatch>(
  matches: readonly TMatch[],
): ActivatedRouteTree<TMatch> => {
  const branch: Array<MutableActivatedRouteNode<TMatch>> = matches.map((match, depth) => ({
    depth,
    match,
  }));

  branch.forEach((node, index) => {
    const parent = branch[index - 1];
    const child = branch[index + 1];

    if (parent) {
      node.parent = parent;
    }

    if (child) {
      node.child = child;
    }
  });

  const root = branch[0];
  const leaf = branch.at(-1);

  return {
    ...(root ? { root } : {}),
    ...(leaf ? { leaf } : {}),
    branch,
  };
};
