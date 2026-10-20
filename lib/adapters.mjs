// Adapter container: l'unico punto che conosce le implementazioni concrete.
import { streamUpstream, callModel, transcribeImages } from "./llm.mjs";
import { runSympy } from "./sympy.mjs";
import { runGGB, runGGBEdit, resolveGGB } from "./geogebra.mjs";
import { audioToText } from "./audio.mjs";
import { docToText } from "./documents.mjs";
import { assertPorts } from "./ports.mjs";

export const adapters = Object.freeze({
  llm: Object.freeze({ stream: streamUpstream, generate: callModel, vision: transcribeImages }),
  math: Object.freeze({ compute: runSympy }),
  graph: Object.freeze({ run: runGGB, edit: runGGBEdit, resolve: resolveGGB }),
  audio: Object.freeze({ transcribe: audioToText }),
  documents: Object.freeze({ extractText: docToText }),
});

assertPorts(adapters);
