/**
 * Shared assembly of CycloneDX document-level annotations.
 *
 * Two postgen features attach findings to the BOM document as annotations
 * whose `subjects` is the BOM serial number: the BOM audit's rule findings and
 * the build introspection's remediations. Both describe the document rather
 * than a component, both are annotated by the cdxgen tool component from
 * metadata, and both carry the document's own timestamp because an annotation
 * describes the document it is attached to. The structured facts travel as
 * `name`/`value` pairs rendered into the annotation text, one `:evidence:<key>`
 * entry per evidence item.
 */

import { DEBUG_MODE } from "../../core/activity.js";
import { getTimestamp } from "../../core/fs.js";
import { buildAnnotationText } from "../../helpers/annotationFormatter.js";

/**
 * Find the cdxgen tool component that annotates the document.
 *
 * @param {Object} bomJson CycloneDX BOM
 * @returns {Object[]} The cdxgen tool components, empty when metadata carries none.
 */
function findCdxgenAnnotator(bomJson) {
  return (
    bomJson?.metadata?.tools?.components?.filter((c) => c.name === "cdxgen") ||
    []
  );
}

/**
 * Flatten an evidence object into `:evidence:<key>` property entries. Nested
 * values are serialized as JSON so every property value stays a string.
 *
 * @param {string} propertyNamePrefix Property namespace, e.g. "cdx:audit".
 * @param {Object} evidence Arbitrary key/value evidence facts.
 * @returns {{name: string, value: string}[]} Property entries.
 */
export function evidenceProperties(propertyNamePrefix, evidence) {
  const properties = [];
  if (evidence && typeof evidence === "object") {
    for (const [key, value] of Object.entries(evidence)) {
      const propValue =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      properties.push({
        name: `${propertyNamePrefix}:evidence:${key}`,
        value: propValue,
      });
    }
  }
  return properties;
}

/**
 * Build one document-level annotation. Returns undefined when the BOM carries
 * no cdxgen tool component to annotate with; the caller decides whether that
 * is worth a warning.
 *
 * @param {Object} params Annotation inputs.
 * @param {Object} params.bomJson CycloneDX BOM the annotation describes.
 * @param {string} params.message Leading annotation sentence.
 * @param {{name: string, value: string}[]} params.properties Structured facts rendered into the annotation text.
 * @returns {Object|undefined} CycloneDX annotation, or undefined without an annotator.
 */
export function buildDocumentAnnotation({ bomJson, message, properties }) {
  const cdxgenAnnotator = findCdxgenAnnotator(bomJson);
  if (!cdxgenAnnotator.length) {
    return undefined;
  }
  return {
    subjects: [bomJson.serialNumber],
    annotator: {
      component: cdxgenAnnotator[0],
    },
    // An annotation describes the document it is attached to, so it carries
    // that document's timestamp rather than the moment the annotation was
    // built.
    timestamp: bomJson.metadata?.timestamp || getTimestamp(),
    text: buildAnnotationText(message, properties),
  };
}

/**
 * Warn that a document could not be annotated because it carries no cdxgen
 * tool component. Suppressed outside debug mode, where the missing annotator
 * is an expected shape for foreign BOMs.
 *
 * @param {string} feature Feature that wanted to annotate.
 * @returns {void}
 */
export function warnMissingAnnotator(feature) {
  if (DEBUG_MODE) {
    console.warn(
      `Cannot create ${feature} annotations: cdxgen tool component not found in metadata`,
    );
  }
}
