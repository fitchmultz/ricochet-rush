import { BRIEF_KIND_MATCH_ORDER, eyeFeatureKindMatcherSource, kindMatcherSource, type BrickKind } from "./brickKinds";

const SENTENCE_BOUNDARY_PATTERN = /[.!?\n]/;

export type DesignerBriefShape = "heart" | "diamond" | "circle" | "triangle" | "cross" | "x";

export type DesignerBriefFeature = "eyes" | "core";
export type DesignerBriefFeatureConstraint = { kind: BrickKind; feature: DesignerBriefFeature };

export interface DesignerBriefAnalysis {
  exclusiveKind?: BrickKind;
  preferredKind?: BrickKind;
  mentionedKinds: BrickKind[];
  excludedKinds: BrickKind[];
  requiredKindFeatures: DesignerBriefFeatureConstraint[];
  localizedKindFeatures: DesignerBriefFeatureConstraint[];
  shape?: DesignerBriefShape;
}

export function analyzeDesignerBrief(brief: string): DesignerBriefAnalysis {
  const text = normalizeBriefText(brief);
  const kinds = brickKindsFromBrief(text);
  const mentionedKinds = positiveKindsFromBrief(text, kinds);
  const excludedKinds = excludedKindsFromBrief(text, kinds);
  const kind = mentionedKinds[0];
  const rawExclusiveKind = exclusiveKindFromBrief(text, mentionedKinds);
  const exclusiveKind = rawExclusiveKind && !excludedKinds.includes(rawExclusiveKind) ? rawExclusiveKind : undefined;
  const parsedLocalizedKindFeatures = exclusiveKind ? [] : localizedKindFeaturesFromBrief(text, mentionedKinds);
  const allowedLocalizedKindFeatures = parsedLocalizedKindFeatures.filter((feature) => !excludedKinds.includes(feature.kind));
  const parsedRequiredKindFeatures = exclusiveKind ? [] : requiredKindFeaturesFromBrief(text, mentionedKinds);
  const requiredKindFeatures = exclusiveKind ? [] : mergeFeatureConstraints(allowedLocalizedKindFeatures, parsedRequiredKindFeatures.filter((feature) => !excludedKinds.includes(feature.kind)));
  const localizedKindFeatures = mergeFeatureConstraints(
    allowedLocalizedKindFeatures,
    requiredKindFeatures.filter((feature) => allowedLocalizedKindFeatures.some((localizedFeature) => localizedFeature.kind === feature.kind))
  );
  return {
    exclusiveKind,
    preferredKind:
      !exclusiveKind &&
      localizedKindFeatures.length === 0 &&
      kind &&
      mentionedKinds.length === 1 &&
      !excludedKinds.includes(kind) &&
      !hasElsewhereKindNegation(text, kind) &&
      !hasEnforceableFeatureKindException(text, kind) &&
      !hasLocalizedOnlyQualifier(text, kind)
        ? kind
        : undefined,
    mentionedKinds,
    excludedKinds,
    requiredKindFeatures,
    localizedKindFeatures,
    shape: shapeFromBrief(text)
  };
}

export function normalizeBriefText(brief: string): string {
  return brief.toLowerCase().replace(/\+/g, " plus ").replace(/\bboss-core\b/g, "boss core");
}

function positiveKindsFromBrief(text: string, kinds: BrickKind[]): BrickKind[] {
  const negatedSpans = negatedKindSpans(text);
  return kinds.filter((kind) => {
    if (hasEnforceableFeatureKindException(text, kind)) return true;
    const matcher = new RegExp(`\\b${kindMatcherSource(kind)}\\b`, "g");
    for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
      if (!negatedSpans.some((span) => match.index >= span.start && match.index < span.end)) return true;
    }
    return false;
  });
}

function excludedKindsFromBrief(text: string, kinds: BrickKind[]): BrickKind[] {
  return kinds.filter((kind) => hasExcludedKindMention(text, kind));
}

function hasExcludedKindMention(text: string, kind: BrickKind): boolean {
  const kindPattern = kindMatcherSource(kind);
  const hasFreePhrase = new RegExp(`\\b${kindPattern}[-\\s]+free\\b`).test(text) || new RegExp(`\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b`).test(text);
  if (hasFreePhrase) return !hasEnforceableFeatureKindException(text, kind);
  if (hasEnforceableFeatureKindException(text, kind) || hasEnforceableFeatureExceptionTarget(text, kind)) return false;
  if (FEATURE_DESCRIPTORS.some((feature) => hasLocalizedFeatureKind(text, kind, feature)) && hasElsewhereKindNegation(text, kind)) return false;
  return negationClauses(text).some((clause) => {
    if (!new RegExp(`\\b${kindPattern}\\b`).test(clause)) return false;
    if (clauseHasEnforceableFeatureKindException(clause, kind)) return false;
    if (kind === "boss") {
      const nonBossKindPattern = BRIEF_KIND_MATCH_ORDER.filter((candidate) => candidate !== "boss").map(kindMatcherSource).join("|");
      const explicitBossExclusion = /\b(?:no|not|avoid|without|exclude|excluding)\b[^.;,!?\n]*\bboss(?:es)?\b/.test(clause);
      const coreAsOtherKindFeature = new RegExp(`\\b(?:${nonBossKindPattern})\\s+(?:the\\s+)?(?:boss\\s+)?cores?\\b|\\b(?:the\\s+)?(?:boss\\s+)?cores?\\s+(?:${nonBossKindPattern})\\b`).test(clause);
      const bareCoreExclusion = /\b(?:no|not|avoid|without|exclude|excluding)\s+(?:the\s+)?(?:boss\s+)?cores?\b/.test(clause) && !coreAsOtherKindFeature;
      const coreLocation = clause.search(/\b(?:elsewhere|outside|beyond|inside|in|on|at|around)\s+(?:the\s+)?(?:boss\s+)?cores?\b/);
      if (coreLocation >= 0 && !/\bboss(?:es)?\b/.test(clause.slice(0, coreLocation))) return false;
      if (!explicitBossExclusion && !bareCoreExclusion) return false;
    }
    return true;
  });
}

function exclusiveKindFromBrief(text: string, positiveKinds: BrickKind[]): BrickKind | undefined {
  if (positiveKinds.length !== 1) return undefined;
  const kind = positiveKinds[0];
  if (!kind) return undefined;
  if (hasExplicitGlobalExclusiveKindPhrase(text, kind)) return kind;
  if (hasLocalizedOnlyQualifier(text, kind)) return undefined;
  return hasWeakGlobalExclusiveKindPhrase(text, kind) ? kind : undefined;
}

interface DesignerBriefFeatureDescriptor {
  id: DesignerBriefFeature;
  source: string;
  useEyeKindMatcher?: boolean;
}

const FEATURE_DESCRIPTORS: DesignerBriefFeatureDescriptor[] = [
  { id: "eyes", source: "(?:eyes?)", useEyeKindMatcher: true },
  { id: "core", source: "(?:(?:boss\\s+)?cores?)" }
];

function localizedKindFeaturesFromBrief(text: string, kinds: BrickKind[]): DesignerBriefFeatureConstraint[] {
  return mergeFeatureConstraints(
    kinds.flatMap((kind) =>
      FEATURE_DESCRIPTORS.filter((feature) => hasLocalizedFeatureKind(text, kind, feature)).map((feature) => ({ kind, feature: feature.id }))
    )
  );
}

function requiredKindFeaturesFromBrief(text: string, kinds: BrickKind[]): DesignerBriefFeatureConstraint[] {
  return mergeFeatureConstraints(
    kinds.flatMap((kind) =>
      FEATURE_DESCRIPTORS.filter((feature) => hasRequiredFeatureKind(text, kind, feature)).map((feature) => ({ kind, feature: feature.id }))
    )
  );
}

export function mergeFeatureConstraints(...groups: DesignerBriefFeatureConstraint[][]): DesignerBriefFeatureConstraint[] {
  const merged: DesignerBriefFeatureConstraint[] = [];
  for (const feature of groups.flat()) {
    if (!merged.some((existing) => existing.kind === feature.kind && existing.feature === feature.feature)) merged.push(feature);
  }
  const coreHasNonBossKind = merged.some((feature) => feature.feature === "core" && feature.kind !== "boss");
  return coreHasNonBossKind ? merged.filter((feature) => !(feature.feature === "core" && feature.kind === "boss")) : merged;
}

function hasLocalizedFeatureKind(text: string, kind: BrickKind, feature: DesignerBriefFeatureDescriptor): boolean {
  const kindPattern = featureKindMatcherSource(kind, feature);
  const brickNoun = "(?:bricks?|blocks?|cells?)";
  const kindWithNoun = `${kindPattern}\\s*(?:${brickNoun})?`;
  const featureRef = featureReferenceSource(feature);
  const localQuantifier = "(?:only|just|all|exclusively|entirely)";
  const featureVerb = "(?:(?:(?:that|which)\\s+)?(?:as|with|using|use|uses|are|is|should\\s+be|must\\s+be|should\\s+use|must\\s+use))";
  if (
    hasCombinedEyesCoreFeatureKind(text, kind, "localized") ||
    hasFeatureKindExceptionForFeature(text, kind, feature) ||
    (hasRequiredFeatureKind(text, kind, feature) && hasElsewhereKindNegation(text, kind)) ||
    (hasKindNegationOrFreePhrase(text, kind) && hasEnforceableFeatureExceptionTargetForFeature(text, kind, feature.source)) ||
    hasFreeFeatureException(text, kind, feature.source)
  ) {
    return true;
  }
  const hasElsewhereExclusion = hasElsewhereKindNegation(text, kind);
  const patterns = [
    `\\b${localQuantifier}\\s+${kindPattern}\\s+${featureRef}\\b`,
    `\\b${localQuantifier}\\s+${featureRef}\\s+(?:${featureVerb}\\s+)?${kindWithNoun}\\b`,
    `\\b${localQuantifier}\\s+${kindWithNoun}\\s+(?:for|as|in|on|at|around|inside)\\s+${featureRef}\\b`,
    `\\b${localQuantifier}\\s+(?:use|uses|place|places|put|puts|make|makes)\\s+${kindWithNoun}\\s+(?:for|as|in|on|at|around|inside)\\s+${featureRef}\\b`,
    `\\b${kindWithNoun}\\s+${localQuantifier}\\s+(?:for|as|in|on|at|around|inside)\\s+${featureRef}\\b`,
    `\\b${kindWithNoun}\\s+(?:for|as|in|on|at|around|inside)\\s+${featureRef}\\s+${localQuantifier}\\b`,
    `\\b${kindPattern}\\s+${featureRef}\\s+${localQuantifier}\\b`,
    `\\b${featureRef}\\s+(?:${featureVerb}\\s+)?${localQuantifier}\\s+${kindWithNoun}\\b`,
    `\\b${featureRef}\\s+(?:(?:should|must|can)\\s+)?${localQuantifier}\\s+(?:be|use|uses|have|has|place|places|contain|contains)\\s+${kindWithNoun}\\b`,
    `\\b${featureRef}\\s+(?:${featureVerb}\\s+)?${kindWithNoun}\\s+${localQuantifier}\\b`,
    `\\b${featureRef}\\s+(?:${featureVerb}\\s+)?(?:nothing\\s+but)\\s+${kindWithNoun}\\b`,
    `\\b${featureRef}\\s+(?:made|built|filled)\\s+(?:only|entirely|exclusively|just)\\s+(?:of|from|with)\\s+${kindWithNoun}\\b`,
    `\\b${featureRef}\\s+(?:made|built|filled)\\s+(?:of|from|with)\\s+(?:only|entirely|exclusively|just)\\s+${kindWithNoun}\\b`,
    ...(hasElsewhereExclusion ? [`\\b${kindPattern}\\s+${featureRef}\\b`, `\\b${featureRef}\\s+(?:${featureVerb}\\s+)?${kindWithNoun}\\b`] : [])
  ];
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}

function hasRequiredFeatureKind(text: string, kind: BrickKind, feature: DesignerBriefFeatureDescriptor): boolean {
  const kindPattern = featureKindMatcherSource(kind, feature);
  const brickNoun = "(?:bricks?|blocks?|cells?)";
  const kindWithNoun = `${kindPattern}\\s*(?:${brickNoun})?`;
  const kindWithNounNotFeatureScoped = `${kindPattern}(?:\\s+${brickNoun})?(?!\\s+(?:${featurePatternSource()}))`;
  const featureRef = featureReferenceSource(feature);
  const featureVerb = "(?:(?:(?:that|which)\\s+)?(?:as|with|using|use|uses|are|is|should\\s+be|must\\s+be|should\\s+use|must\\s+use))";
  if (hasCombinedEyesCoreFeatureKind(text, kind, "required")) return true;
  const patterns = [
    `\\b${kindPattern}\\s+${featureRef}\\b`,
    `\\b${featureRef}\\s+(?:${featureVerb}\\s+)?${kindWithNounNotFeatureScoped}\\b`,
    `\\b${kindWithNounNotFeatureScoped}\\s+(?:for|as|in|on|at|around|inside)\\s+${featureRef}\\b`,
    `\\b${featureRef}\\s+(?:is|are|as|use|uses|should\\s+be|must\\s+be)\\s+${kindWithNoun}\\b`,
    `\\b${kindWithNoun}\\s+(?:in|inside|on|at|around)\\s+${featureRef}\\b`
  ];
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}

function featureKindMatcherSource(kind: BrickKind, feature: DesignerBriefFeatureDescriptor): string {
  return feature.useEyeKindMatcher ? eyeFeatureKindMatcherSource(kind) : kindMatcherSource(kind);
}

function featureReferenceSource(feature: DesignerBriefFeatureDescriptor): string {
  return `(?:the\\s+)?${feature.source}`;
}

function hasCombinedEyesCoreFeatureKind(text: string, kind: BrickKind, mode: "localized" | "required"): boolean {
  if (kind === "boss") return false;
  const kindPattern = kindMatcherSource(kind);
  const connector = "(?:and|or|plus|&)";
  const eyeFeature = featureReferenceSource(FEATURE_DESCRIPTORS[0]!);
  const coreFeature = featureReferenceSource(FEATURE_DESCRIPTORS[1]!);
  const combinedFeature = `(?:${eyeFeature}\\s+${connector}\\s+${coreFeature}|${coreFeature}\\s+${connector}\\s+${eyeFeature})`;
  const localQuantifier = "(?:only|just|all|exclusively|entirely)";
  const exceptionConnector = "(?:except|but|apart\\s+from|other\\s+than|outside|beyond|elsewhere)";
  const requiredPatterns = [
    `\\b${kindPattern}\\s+${eyeFeature}\\b[^.;,!?\\n]*\\b${connector}\\s+(?:${kindPattern}\\s+)?${coreFeature}\\b`,
    `\\b${kindPattern}\\s+${coreFeature}\\b[^.;,!?\\n]*\\b${connector}\\s+(?:${kindPattern}\\s+)?${eyeFeature}\\b`,
    `\\b${combinedFeature}\\s+(?:are|is|as|use|uses|should\\s+be|must\\s+be)\\s+${kindPattern}\\b`,
    `\\b${combinedFeature}\\s+${kindPattern}\\b`
  ];
  const hasRequiredPattern = requiredPatterns.some((pattern) => new RegExp(pattern).test(text));
  if (mode === "required") return hasRequiredPattern;
  const localizedPatterns = [
    `\\b(?:no|not|avoid|without|exclude|excluding)\\b[^.!?\\n]*\\b${kindPattern}\\b[^.!?\\n]*\\b${exceptionConnector}\\s+${combinedFeature}\\b`,
    `\\b${kindPattern}[-\\s]+free\\b[^.!?\\n]*\\b${exceptionConnector}\\s+${combinedFeature}\\b`,
    `\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b[^.!?\\n]*\\b${exceptionConnector}\\s+${combinedFeature}\\b`,
    `\\b${localQuantifier}\\s+${combinedFeature}\\s+(?:are|is|as|use|uses|with)?\\s*${kindPattern}\\b`,
    `\\b${combinedFeature}\\s+(?:are|is|as|use|uses|with)?\\s*${localQuantifier}\\s+${kindPattern}\\b`
  ];
  return localizedPatterns.some((pattern) => new RegExp(pattern).test(text));
}

function hasElsewhereKindNegation(text: string, kind: BrickKind): boolean {
  const kindPattern = kindMatcherSource(kind);
  return new RegExp(`\\b(?:no|not|avoid|without|exclude|excluding)\\b[^.;,!?\\n]*\\b${kindPattern}\\b[^.;,!?\\n]*\\b(?:elsewhere|outside|beyond)\\b`).test(text);
}

function hasKindNegationOrFreePhrase(text: string, kind: BrickKind): boolean {
  const kindPattern = kindMatcherSource(kind);
  const sameExceptionFreeNegation = `(?:(?!\\b(?:except|but|apart\\s+from|other\\s+than)\\b)[^.;,!?\\n])*`;
  return (
    negationClauses(text).some((clause) => new RegExp(`\\b(?:no|not|avoid|without|exclude|excluding)\\b${sameExceptionFreeNegation}\\b${kindPattern}\\b`).test(clause)) ||
    new RegExp(`\\b${kindPattern}[-\\s]+free\\b`).test(text) ||
    new RegExp(`\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b`).test(text)
  );
}

function hasEnforceableFeatureKindException(text: string, kind: BrickKind): boolean {
  return FEATURE_DESCRIPTORS.some((feature) => hasFeatureKindExceptionForFeature(text, kind, feature) || hasFreeFeatureException(text, kind, feature.source));
}

function hasFeatureKindExceptionForFeature(text: string, kind: BrickKind, feature: DesignerBriefFeatureDescriptor): boolean {
  return hasTextFeatureKindException(text, kind, feature.source) || negationClauses(text).some((clause) => clauseHasFeatureKindException(clause, kind, feature.source));
}

function hasEnforceableFeatureExceptionTarget(text: string, kind: BrickKind): boolean {
  return FEATURE_DESCRIPTORS.some((feature) => hasEnforceableFeatureExceptionTargetForFeature(text, kind, feature.source));
}

function hasEnforceableFeatureExceptionTargetForFeature(text: string, kind: BrickKind, featurePattern: string): boolean {
  const kindPattern = kindMatcherSource(kind);
  const anyKindPattern = BRIEF_KIND_MATCH_ORDER.map(kindMatcherSource).join("|");
  const kindFeatureTarget = kindFeatureTargetSource(kindPattern, featurePattern, kind, false);
  const bareFeatureTarget = bareFeatureTargetSource(featurePattern, kind);
  const exceptionConnector = "(?:except|but|apart\\s+from|other\\s+than)";
  const optionalPunctuation = "(?:\\s*[,;:]\\s*)?";
  const explicitConnector = new RegExp(`${optionalPunctuation}\\b${exceptionConnector}\\s+${kindFeatureTarget}\\b`, "g");
  for (let match = explicitConnector.exec(text); match; match = explicitConnector.exec(text)) {
    const prefix = text.slice(0, match.index);
    for (const marker of negationOrFreeMarkers(prefix, anyKindPattern)) {
      const scopedPrefix = prefix.slice(marker.index);
      if (!SENTENCE_BOUNDARY_PATTERN.test(scopedPrefix) && new RegExp(`\\b${kindPattern}\\b`).test(scopedPrefix)) return true;
    }
  }
  const bareConnector = new RegExp(`${optionalPunctuation}\\b${exceptionConnector}\\s+${bareFeatureTarget}\\b`, "g");
  for (let match = bareConnector.exec(text); match; match = bareConnector.exec(text)) {
    const prefix = text.slice(0, match.index);
    const marker = lastNegationOrFreeMarker(prefix, anyKindPattern);
    const scopedPrefix = marker ? prefix.slice(marker.index) : "";
    if (marker && !SENTENCE_BOUNDARY_PATTERN.test(scopedPrefix) && new RegExp(`\\b${kindPattern}\\b`).test(scopedPrefix)) return true;
  }
  return false;
}

function sameKindFeatureClauseSource(anyKindPattern: string): string {
  const negatedKindStart = `\\b(?:and|or|plus|with)\\s+(?:(?:no|not|avoid|without|exclude|excluding)\\s+)?(?:${anyKindPattern})\\b`;
  const freeKindStart = `\\b(?:and|or|plus|with)\\s+(?:free\\s+of\\s+(?:any\\s+)?(?:${anyKindPattern})|(?:${anyKindPattern})[-\\s]+free)\\b`;
  return `(?:(?!(?:${negatedKindStart}|${freeKindStart}))[^.;,!?\\n])*`;
}

function negationOrFreeMarkers(text: string, anyKindPattern: string): RegExpExecArray[] {
  const markerPattern = new RegExp(`\\b(?:no|not|avoid|without|exclude|excluding)\\b|\\b(?:${anyKindPattern})[-\\s]+free\\b|\\bfree\\s+of\\s+(?:any\\s+)?(?:${anyKindPattern})\\b`, "g");
  const markers: RegExpExecArray[] = [];
  for (let match = markerPattern.exec(text); match; match = markerPattern.exec(text)) markers.push(match);
  return markers;
}

function lastNegationOrFreeMarker(text: string, anyKindPattern: string): RegExpExecArray | undefined {
  return negationOrFreeMarkers(text, anyKindPattern).at(-1);
}

function clauseHasEnforceableFeatureKindException(clause: string, kind: BrickKind): boolean {
  return FEATURE_DESCRIPTORS.some((feature) => clauseHasFeatureKindException(clause, kind, feature.source));
}

function hasFreeFeatureException(text: string, kind: BrickKind, featurePattern = featurePatternSource()): boolean {
  const kindPattern = kindMatcherSource(kind);
  const anyKindPattern = BRIEF_KIND_MATCH_ORDER.map(kindMatcherSource).join("|");
  const featureTarget = kindFeatureTargetSource(kindPattern, featurePattern, kind, true);
  const additiveFeatureTarget = kindFeatureTargetSource(kindPattern, featurePattern, kind, false);
  const bareFeatureTarget = bareFeatureTargetSource(featurePattern, kind);
  const exceptionConnector = "(?:except|but|apart\\s+from|other\\s+than)";
  const additiveConnector = "(?:and|plus|with)";
  const optionalPunctuation = "(?:\\s*[,;:]\\s*)?";
  const sameFreeClause = sameKindFeatureClauseSource(anyKindPattern);
  return (
    new RegExp(`\\b${kindPattern}[-\\s]+free\\b${sameFreeClause}${optionalPunctuation}\\b${exceptionConnector}\\s+${bareFeatureTarget}\\b`).test(text) ||
    new RegExp(`\\b${kindPattern}[-\\s]+free\\b${sameFreeClause}${optionalPunctuation}\\b${exceptionConnector}\\s+${featureTarget}\\b`).test(text) ||
    new RegExp(`\\b${kindPattern}[-\\s]+free\\b${sameFreeClause}${optionalPunctuation}\\b${additiveConnector}\\s+${additiveFeatureTarget}\\b`).test(text) ||
    new RegExp(`\\b${kindPattern}[-\\s]+free\\b${sameFreeClause}\\b(?:elsewhere|outside|beyond)\\s+(?:of\\s+)?(?:the\\s+)?${featurePattern}\\b`).test(text) ||
    new RegExp(`\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b${sameFreeClause}${optionalPunctuation}\\b${exceptionConnector}\\s+${bareFeatureTarget}\\b`).test(text) ||
    new RegExp(`\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b${sameFreeClause}${optionalPunctuation}\\b${exceptionConnector}\\s+${featureTarget}\\b`).test(text) ||
    new RegExp(`\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b${sameFreeClause}${optionalPunctuation}\\b${additiveConnector}\\s+${additiveFeatureTarget}\\b`).test(text) ||
    new RegExp(`\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b${sameFreeClause}\\b(?:elsewhere|outside|beyond)\\s+(?:of\\s+)?${bareFeatureTarget}\\b`).test(text)
  );
}

function hasTextFeatureKindException(text: string, kind: BrickKind, featurePattern = featurePatternSource()): boolean {
  const kindPattern = kindMatcherSource(kind);
  const anyKindPattern = BRIEF_KIND_MATCH_ORDER.map(kindMatcherSource).join("|");
  const featureTarget = kindFeatureTargetSource(kindPattern, featurePattern, kind, true);
  const additiveFeatureTarget = kindFeatureTargetSource(kindPattern, featurePattern, kind, false);
  const bareFeatureTarget = bareFeatureTargetSource(featurePattern, kind);
  const exceptionConnector = "(?:except|but|apart\\s+from|other\\s+than)";
  const additiveConnector = "(?:and|plus|with)";
  const optionalPunctuation = "(?:\\s*[,;:]\\s*)?";
  const sameNegationClause = `(?:(?!\\b(?:and|plus|with)\\s+(?:no|not|avoid|without|exclude|excluding)\\b)[^.;,!?\\n])*`;
  const sameKindFeatureClause = sameKindFeatureClauseSource(anyKindPattern);
  return (
    new RegExp(`\\b(?:no|not|avoid|without|exclude|excluding)\\b${sameNegationClause}\\b${kindPattern}\\b${sameKindFeatureClause}${optionalPunctuation}\\b${exceptionConnector}\\s+${featureTarget}\\b`).test(text) ||
    new RegExp(`\\b(?:no|not|avoid|without|exclude|excluding)\\b${sameNegationClause}\\b${kindPattern}\\b${sameKindFeatureClause}${optionalPunctuation}\\b${additiveConnector}\\s+${additiveFeatureTarget}\\b`).test(text) ||
    new RegExp(`\\b(?:no|not|avoid|without|exclude|excluding)\\b${sameNegationClause}\\b${kindPattern}\\b${sameKindFeatureClause}\\b(?:elsewhere|outside|beyond)\\s+(?:of\\s+)?${bareFeatureTarget}\\b`).test(text)
  );
}

function clauseHasFeatureKindException(clause: string, kind: BrickKind, featurePattern = featurePatternSource()): boolean {
  const kindPattern = kindMatcherSource(kind);
  const anyKindPattern = BRIEF_KIND_MATCH_ORDER.map(kindMatcherSource).join("|");
  const sameKindFeatureClause = sameKindFeatureClauseSource(anyKindPattern);
  const featureTarget = kindFeatureTargetSource(kindPattern, featurePattern, kind, true);
  const additiveFeatureTarget = kindFeatureTargetSource(kindPattern, featurePattern, kind, false);
  const bareFeatureTarget = bareFeatureTargetSource(featurePattern, kind);
  const exceptionConnector = "(?:except|but|apart\\s+from|other\\s+than)";
  const additiveConnector = "(?:and|plus|with)";
  const optionalPunctuation = "(?:\\s*[,;:]\\s*)?";
  return (
    new RegExp(`\\b${kindPattern}\\b${sameKindFeatureClause}${optionalPunctuation}\\b${exceptionConnector}\\s+${featureTarget}\\b`).test(clause) ||
    new RegExp(`\\b${kindPattern}\\b${sameKindFeatureClause}${optionalPunctuation}\\b${additiveConnector}\\s+${additiveFeatureTarget}\\b`).test(clause) ||
    new RegExp(`\\b${kindPattern}\\b${sameKindFeatureClause}\\b(?:elsewhere|outside|beyond)\\s+(?:of\\s+)?${bareFeatureTarget}\\b`).test(clause)
  );
}

function kindFeatureTargetSource(kindPattern: string, featurePattern: string, kind: BrickKind, includeBareFeature: boolean): string {
  const brickNoun = "(?:bricks?|blocks?|cells?)";
  const bareFeatureTarget = bareFeatureTargetSource(featurePattern, kind);
  const localQuantifier = "(?:only|just|all|exclusively|entirely)";
  const featureVerb = "(?:are|is|as|use|uses|with|should\\s+be|must\\s+be|should\\s+use|must\\s+use)";
  const kindFirstTarget = `${kindPattern}\\s+${bareFeatureTarget}`;
  const featureFirstTarget = `(?:(?:on|in|at|around|inside)\\s+)?(?:the\\s+)?${featurePattern}\\s+${kindPattern}\\s*(?:${brickNoun})?`;
  const localizedFeatureTarget = `(?:(?:on|in|at|around|inside)\\s+)?(?:the\\s+)?${featurePattern}\\s+(?:(?:${featureVerb})\\s+${localQuantifier}\\s+|(?:(?:should|must|can)\\s+)?${localQuantifier}\\s+(?:be|use|uses|have|has|place|places|contain|contains)\\s+|${localQuantifier}\\s+|(?:${featureVerb})\\s+)?${kindPattern}\\s*(?:${brickNoun})?\\s*(?:${localQuantifier})?`;
  const targets = [kindFirstTarget, localizedFeatureTarget, featureFirstTarget];
  if (includeBareFeature) targets.push(bareFeatureTarget);
  return `(?:${targets.join("|")})`;
}

function bareFeatureTargetSource(featurePattern: string, _kind: BrickKind): string {
  const base = `(?:for\\s+)?(?:(?:on|in|at|around|inside)\\s+)?(?:the\\s+)?${featurePattern}`;
  const anyKindPattern = BRIEF_KIND_MATCH_ORDER.map(kindMatcherSource).join("|");
  return `${base}(?!\\s+(?:${anyKindPattern})\\b)`;
}

function negationClauses(text: string): string[] {
  const clauses: string[] = [];
  const negation = /\b(?:no|not|avoid|without|exclude|excluding)\b/g;
  const anyKindPattern = BRIEF_KIND_MATCH_ORDER.map(kindMatcherSource).join("|");
  const featurePattern = featurePatternSource();
  const boundaryPattern = negationBoundarySource(anyKindPattern, featurePattern);
  for (let match = negation.exec(text); match; match = negation.exec(text)) {
    const rest = text.slice(match.index);
    const boundary = rest.search(new RegExp(boundaryPattern));
    clauses.push(rest.slice(0, boundary >= 0 ? boundary : undefined));
  }
  return clauses;
}

function negatedKindSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const negation = /\b(?:no|not|avoid|without|exclude|excluding)\b/g;
  const anyKindPattern = BRIEF_KIND_MATCH_ORDER.map(kindMatcherSource).join("|");
  const featurePattern = featurePatternSource();
  const boundaryPattern = negationBoundarySource(anyKindPattern, featurePattern);
  for (let match = negation.exec(text); match; match = negation.exec(text)) {
    const rest = text.slice(match.index);
    const boundary = rest.search(new RegExp(boundaryPattern));
    spans.push({ start: match.index, end: boundary >= 0 ? match.index + boundary : text.length });
  }
  for (const kind of BRIEF_KIND_MATCH_ORDER) {
    const kindPattern = kindMatcherSource(kind);
    for (const pattern of [new RegExp(`\\b${kindPattern}[-\\s]+free\\b`, "g"), new RegExp(`\\bfree\\s+of\\s+(?:any\\s+)?${kindPattern}\\b`, "g")]) {
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        spans.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }
  return spans;
}

function negationBoundarySource(anyKindPattern: string, featurePattern: string): string {
  const brickNoun = "(?:bricks?|blocks?|cells?)";
  const localQuantifier = "(?:only|just|all|exclusively|entirely)";
  const featureVerb = "(?:are|is|as|use|uses|with|should\\s+be|must\\s+be|should\\s+use|must\\s+use)";
  const localizedFeatureKind = `\\b(?:and|plus|with)\\s+(?:the\\s+)?${featurePattern}\\s+(?:(?:${featureVerb})\\s+${localQuantifier}\\s+|(?:(?:should|must|can)\\s+)?${localQuantifier}\\s+(?:be|use|uses|have|has|place|places|contain|contains)\\s+|${localQuantifier}\\s+|(?:${featureVerb})\\s+)?(?:${anyKindPattern})\\s*(?:${brickNoun})?\\s*(?:${localQuantifier})?\\b`;
  return `[.;,!?\\n]|\\bbut\\b|\\balthough\\b|\\bexcept\\b|\\b(?:and|plus|with)\\s+(?:no|not|avoid|without|exclude|excluding)\\b|\\b(?:and|plus)\\s+(?:only|use|uses|make|made|all|every|nothing|just|exclusively|entirely)\\b|\\b(?:and|plus)\\s+(?:${anyKindPattern})\\s*(?:${brickNoun})?\\s+(?:only|exclusively|entirely)\\b|\\b(?:and|plus|with)\\s+(?:${anyKindPattern})\\s+(?:${featurePattern})\\b|${localizedFeatureKind}`;
}

function featurePatternSource(): string {
  return "(?:eyes?|mouth|cheeks?|center|(?:boss\\s+)?cores?|corners?|edges?|accents?|highlights?|features?|pockets?|routes?|sides?)";
}

function hasLocalizedOnlyQualifier(text: string, kind: BrickKind): boolean {
  const kindPattern = kindMatcherSource(kind);
  const featurePattern = featurePatternSource();
  const brickNoun = "(?:bricks?|blocks?|cells?)";
  const featurePrefix = `(?:the\\s+)?${featurePattern}`;
  const kindWithNoun = `${kindPattern}\\s*(?:${brickNoun})?`;
  const localQuantifier = "(?:only|just|all|exclusively|entirely)";
  const featureVerb = "(?:(?:(?:that|which)\\s+)?(?:as|with|using|use|uses|are|is|should\\s+be|must\\s+be|should\\s+use|must\\s+use))";
  const patterns = [
    `\\b${localQuantifier}\\s+${featurePrefix}\\s+(?:${featureVerb}\\s+)?${kindWithNoun}\\b`,
    `\\b${localQuantifier}\\s+${kindWithNoun}\\s+(?:for|as|in|on|at|around|inside)\\s+${featurePrefix}\\b`,
    `\\b${kindWithNoun}\\s+only\\s+(?:for|as|in|on|at|around|inside)\\s+${featurePrefix}\\b`,
    `\\b${kindPattern}\\s+${featurePrefix}\\s+${localQuantifier}\\b`,
    `\\b${localQuantifier}\\s+${kindPattern}\\s+${featurePrefix}\\b`,
    `\\b${featurePrefix}\\s+(?:${featureVerb}\\s+)?${localQuantifier}\\s+${kindWithNoun}\\b`,
    `\\b${featurePrefix}\\s+(?:${featureVerb}\\s+)?${kindWithNoun}\\s+only\\b`,
    `\\b${featurePrefix}\\s+(?:${featureVerb}\\s+)?(?:nothing\\s+but)\\s+${kindWithNoun}\\b`,
    `\\b${featurePrefix}\\s+(?:made|built|filled)\\s+(?:only|entirely|exclusively|just)\\s+(?:of|from|with)\\s+${kindWithNoun}\\b`,
    `\\b${featurePrefix}\\s+(?:made|built|filled)\\s+(?:of|from|with)\\s+(?:only|entirely|exclusively|just)\\s+${kindWithNoun}\\b`
  ];
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}

function hasExplicitGlobalExclusiveKindPhrase(text: string, kind: BrickKind): boolean {
  const { kindPattern, occupiedNoun, targetNoun } = exclusivePatternParts(kind);
  const patterns = [
    `\\b(?:all|every)\\s+${targetNoun}\\s+(?:are|is|as|must\\s+be|should\\s+be|use|uses|made\\s+of)?\\s*${kindPattern}\\b`,
    `\\b${targetNoun}\\s+(?:are|is|must\\s+be|should\\s+be|use|uses|has|have)?\\s*(?:all|only|just|exclusively|entirely|nothing\\s+but)\\s+${kindPattern}\\b`,
    `\\b${targetNoun}\\s+(?:is|are|must\\s+be|should\\s+be)?\\s*(?:made|built|filled)\\s+(?:only|entirely|exclusively|just)?\\s*(?:of|from|with)\\s+(?:only|entirely|exclusively|just)?\\s*${kindPattern}\\s*(?:${occupiedNoun})?\\b`
  ];
  if (kind === "bomb") {
    patterns.push(
      `\\b(?:all|every)\\s+${targetNoun}\\s+(?:explode|explodes|exploding|explosive|detonate|detonates|blast)\\b`,
      `\\b${targetNoun}\\s+(?:all\\s+)?(?:explode|explodes|exploding|explosive|detonate|detonates)\\b`
    );
  }
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}

function hasWeakGlobalExclusiveKindPhrase(text: string, kind: BrickKind): boolean {
  const { kindPattern, occupiedNoun, targetNoun } = exclusivePatternParts(kind);
  const patterns = [
    `\\b(?:only|just|exclusively|entirely)\\s+${kindPattern}\\s*(?:${targetNoun})?\\b`,
    `\\bnothing\\s+but\\s+${kindPattern}\\s*(?:${targetNoun})?\\b`,
    `\\b(?:all|every)\\s+${kindPattern}\\b`,
    `\\b${kindPattern}\\s+only\\b`,
    `\\b${kindPattern}\\s+${occupiedNoun}\\s+(?:only|exclusively)\\b`,
    `\\b(?:all|every)\\s+${kindPattern}\\s+${occupiedNoun}\\b`,
    `\\b(?:made|built|filled)\\s+(?:only|entirely|exclusively|just)\\s+(?:of|from|with)\\s+${kindPattern}\\s*(?:${occupiedNoun})?\\b`,
    `\\b(?:made|built|filled)\\s+(?:of|from|with)\\s+(?:only|entirely|exclusively|just)\\s+${kindPattern}\\s*(?:${occupiedNoun})?\\b`
  ];
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}

function exclusivePatternParts(kind: BrickKind): { kindPattern: string; occupiedNoun: string; targetNoun: string } {
  const kindPattern = kindMatcherSource(kind);
  const occupiedNoun = "(?:occupied\\s+)?(?:bricks?|blocks?|cells?)";
  const boardNoun = "(?:wall|board|grid|layout)";
  return { kindPattern, occupiedNoun, targetNoun: `(?:${occupiedNoun}|${boardNoun})` };
}

export function brickKindsFromBrief(text: string): BrickKind[] {
  const matches: BrickKind[] = [];
  const add = (kind: BrickKind) => {
    if (new RegExp(`\\b${kindMatcherSource(kind)}\\b`).test(text) && !matches.includes(kind)) matches.push(kind);
  };
  for (const kind of BRIEF_KIND_MATCH_ORDER) add(kind);
  return matches;
}

export function shapeFromBrief(text: string): DesignerBriefShape | undefined {
  if (/\b(heart|love|valentine)\b/.test(text)) return "heart";
  if (/\b(diamond|gem|rhombus)\b/.test(text)) return "diamond";
  if (/\b(circle|round|orb|circular)\b/.test(text)) return "circle";
  if (/\b(triangle|pyramid)\b/.test(text)) return "triangle";
  if (/\bcross\b|\bplus[-\s]?(?:sign|shape|shaped|symbol)\b|\b(?:make|draw|build)\s+(?:a\s+)?plus\b|\ba\s+plus\b/.test(text)) return "cross";
  if (/\b(x[- ]?shape|letter x|big x)\b|\b(?:make|draw|build|create)\s+an?\s+x\b|\bx\s+(?:with|made|built|filled|using|of)\b/.test(text)) return "x";
  return undefined;
}
