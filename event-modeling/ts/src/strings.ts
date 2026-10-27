// Every string the user reads: compiler errors, assembly checks, the CLI and the viewer.
export const strings = {
  // A chapter given an unfinished slice fails with "<stillNeeds> <step>".
  compiler: {
    stillNeeds: "this slice still needs",
    sliceStart: ".actor(), .on(), .polls() or .projects()",
    acting: ".service(), .query() or .reads()",
    actingRead: ".service(service, method), or .service(service) then .command()",
    querying: ".reads()",
    needsMethod: ".service(service, method)",
    needsCommand: ".command()",
    needsEmits: ".emits(event)",
    projecting: ".on(event)",
  },

  assembly: {
    noModel: "No module exports a model. Add `export default m.model(...)`.",
    exportedTwice: (name: string, otherName: string) =>
      `'${name}' is also exported as '${otherName}'. Keep one of the two exports.`,
    unnamedChapter: (position: number) =>
      `Chapter #${position} has no name. Export it: \`export const Name = m.chapter([...])\`.`,

    // How an error names a slice: by position until it has a name, then by name.
    sliceAt: (position: number, chapter: string) => `slice #${position} in '${chapter}'`,
    sliceNamed: (slice: string, chapter: string) => `slice '${slice}' in '${chapter}'`,
    kinds: {
      event: "an event",
      command: "a command",
      readModel: "a read model",
      actor: "an actor",
      service: "a service",
      external: "an external system",
    },

    notExported: (slice: string, kind: string) =>
      `${slice} uses ${kind} that no module exports. Export it.`,
    eventFieldUnfilled: (slice: string, event: string, field: string, command: string) =>
      `${slice}: nothing fills ${event}.${field}. ` +
      `Add ${field} to ${command}, or set it in the .emits() mapping.`,
    readModelFieldUnfilled: (slice: string, readModel: string, field: string) =>
      `${slice}: nothing fills ${readModel}.${field}. ` +
      `Add an .on() whose event carries ${field}, or set it in a mapping.`,
    noKeyColumn: (slice: string, event: string, readModel: string, keys: readonly string[]) =>
      `${slice}: ${event} carries none of ${readModel}'s key columns ` +
      `(${keys.join(", ")}). Add one to ${event} or map it in .on().`,
    emitsExternal: (slice: string, event: string, external: string) =>
      `${slice} emits ${event}, which only ${external} emits. ` +
      `Receive it with m.slice().on(${event}) instead.`,
    givenNotEvent: (slice: string, name: string, kind: string) =>
      `${slice}: given has ${name}, ${kind}. given takes events.`,
    whenNotCommand: (slice: string, name: string, kind: string) =>
      `${slice}: when has ${name}, ${kind}. when takes the slice's command.`,
    thenNotEvent: (slice: string, name: string, kind: string) =>
      `${slice}: then has ${name}, ${kind}. then takes events or m.rejected().`,
    methodTaken: (first: string, second: string, method: string) =>
      `${first} and ${second} both use ${method}. Give one its own method: .service(service, "Name").`,

    // Warnings under --partial; errors otherwise.
    inNoSlice: (name: string) => `${name} is in no slice yet.`,
    unused: (slice: string, event: string) =>
      `${slice} emits ${event}, which nothing uses yet. Add .on(${event}) to a slice or use it in a given.`,
    unemitted: (slice: string, event: string) =>
      `${slice} uses ${event}, which no slice emits yet. Add .emits(${event}) to a slice.`,
    unread: (slice: string, readModel: string) =>
      `${slice} projects ${readModel}, which nothing reads yet. Add .reads(${readModel}) or .polls(${readModel}) to a slice.`,
    unprojected: (slice: string, readModel: string) =>
      `${slice} reads ${readModel}, which nothing projects yet. Add a slice with .projects(${readModel}).`,

    // Written into the JSON, so the viewer and the SVG show them.
    defaultLane: "Events",
    systemActor: "System",
  },

  proto: {
    unmappable: (field: string, why: string) =>
      `${field} has no protobuf type (${why}). Use a Zod type from the README's Protobuf table.`,
    schemaType: (type: string) => `JSON schema type ${type}`,
    arrayWithoutItems: "an array with no item type",
  },

  cli: {
    usage: `usage:
  em init   <dir>
  em json   <path> [--partial]
  em render <path> -o <out.svg> [--watch]
  em proto  <path> -o <dir>
  em view   <path> [--port <n>] [--no-open]
  em export <path> -o <out.html>`,
    initModelName: "My System",
    alreadyExists: (path: string) => `${path} already exists. Run init in a new directory.`,
    wrote: (path: string) => `wrote ${path}`,
    watching: (dir: string) => `watching ${dir}`,
    viewing: (path: string, url: string) => `viewing ${path} at ${url}`,
    viewerNotBuilt: (root: string) => `The viewer is not built. Run \`npm run build\` in ${root}.`,
    started: "start",
    saved: (file: string) => `${file} saved`,
    assembled: (time: string, cause: string, took: string, toDo: number) =>
      `${time} ${cause}: assembled in ${took}, ${toDo} to do`,
    assemblyFailed: (time: string, cause: string, took: string) =>
      `${time} ${cause}: assembly failed in ${took}`,
    notFound: "not found",
  },

  viewer: {
    untitledModel: "Event model",
    waiting: "Waiting for the model…",
    stillToDo: "Still to do",
    status: {
      failed: "assembly failed",
      snapshot: "snapshot",
      live: "live",
      disconnected: "disconnected",
    },

    // The legend and the kind on a card or the detail panel.
    kinds: {
      ui: "screen",
      external: "external event",
      command: "command",
      event: "event",
      readModel: "read model",
      automation: "automation",
    },
    slice: "slice",

    nav: "Chapters and slices",
    hint: "← → move between slices · Enter or double click opens one · Esc back to the canvas",
    hasNote: "has a note",
    notFinished: "not finished",

    canvas: (slices: number) => `Event model canvas, ${slices} slices`,
    sliceButton: (title: string) => `Slice ${title}`,
    card: (kind: string, name: string, noted: boolean, warned: boolean) =>
      `${kind} ${name}${noted ? ", has a note" : ""}${warned ? ", not finished" : ""}`,
    drawnElsewhere: "Drawn in full where it first appears",
    goToFull: "Go to where it is drawn in full",
    noteBadge: "Has a note",
    unfinishedBadge: "Not finished: select it to see what is left",
    key: "key",

    // Lanes of the canvas and the slice view.
    automations: "Automations",
    laneKinds: { actor: "Actor", admin: "Admin", system: "System", stream: "Stream" },
    reads: "Reads",
    specifications: "Specifications",
    notInSlice: "Not yet in a slice",
    // Card names the JSON does not give: a translation's gear, a slice with nothing to name it.
    translate: "Translate",
    untitledSlice: "slice",

    details: "Details",
    openTitle: "Open the slice",
    open: "Open",
    closeTitle: "Close (Esc)",
    previous: "Previous slice",
    next: "Next slice",
    backToCanvas: "Canvas",
    headings: { fields: "Fields", query: "Query", slice: "Slice", mapping: "Mapping" },
    facts: {
      name: "Name",
      actor: "Actor",
      service: "Service",
      query: "Query",
      polls: "Polls",
      reads: "Reads",
      on: "On",
    },
    specHeading: (chapter: string, slice: string) => `${chapter} › ${slice}`,
    steps: { given: "given", when: "when", then: "then" },
    rejected: "Rejected",
    source: {
      from: (field: string) => `← ${field}`,
      count: (event: string) => `count of ${event}`,
      value: (json: string) => `= ${json}`,
    },
  },
} as const
