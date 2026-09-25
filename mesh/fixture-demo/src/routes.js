export function listOrganisms() {
  return [{ id: "demo", status: "healthy" }];
}

export function getOrganism(id) {
  return listOrganisms().find((o) => o.id === id) ?? null;
}
