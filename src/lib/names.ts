export type Named = { first_name: string; last_name: string; full_name?: string };

/** First names. When two people in the same view share a first name, add the last initial. */
export function displayName(person: Named, view: Named[]): string {
  const shares = view.filter((other) => other.first_name === person.first_name);
  if (shares.length > 1) {
    const initial = person.last_name.trim().charAt(0);
    return initial ? `${person.first_name} ${initial}.` : person.first_name;
  }
  return person.first_name;
}
