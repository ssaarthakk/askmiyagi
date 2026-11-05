let active: { root: string; relPath: string; source: string } | undefined;

export function setOverlay(root: string, relPath: string, source: string) {
  active = { root, relPath, source };
}

export function clearOverlay() {
  active = undefined;
}

export function overlaidSource(root: string, relPath: string) {
  return active?.root === root && active.relPath === relPath ? active.source : undefined;
}
