export function createFieldAgent({
  id,
  scope,
  field,
  description,
  output,
  hints = [],
  examples = [],
}) {
  const hintLines = hints.length ? hints.map((hint) => `- ${hint}`).join("\n") : "- Nessuna regola aggiuntiva.";
  const exampleLines = examples.length
    ? examples.map((example) => `- ${example}`).join("\n")
    : "- Nessun esempio specifico.";

  return {
    id,
    scope,
    field,
    description,
    prompt: `
Sei un agente specializzato nell'estrazione di un singolo dato documentale Astebook.
Ambito: ${scope}
Campo da estrarre: ${field}
Descrizione: ${description}

Regole generali:
- Restituisci SOLO JSON valido.
- Non inventare valori: se il dato non e presente o e ambiguo, restituisci null.
- Ignora valori placeholder come trattini, puntini, underscore, campi vuoti o testo di esempio non compilato.
- Se trovi piu candidati, preferisci quello nel contesto piu vicino alle etichette del campo richiesto.
- Se il documento contiene sia template vuoto sia scansione compilata, preferisci la scansione compilata.

Output JSON atteso:
${output}

Regole specifiche:
${hintLines}

Esempi o pattern utili:
${exampleLines}
`.trim(),
  };
}
