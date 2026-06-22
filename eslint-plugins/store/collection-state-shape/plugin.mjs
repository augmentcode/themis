import { arrayElementTypeName, staticString, typeName, unwrapExpression } from "../../ast-utils.mjs";
import { createArchitectureRule } from "../../rule-utils.mjs";

export const ruleId = "collection-state-shape";

const primitiveOrIdTypePattern = /^(?:string|number|boolean|bigint|symbol|null|undefined|[A-Za-z_$][\w$]*(?:Id|ID)|Id|ID)$/;

function isStateShape(declaration) {
  return ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"].includes(declaration?.type) && declaration.id?.name?.endsWith("State");
}

function stateMembers(declaration) {
  if (declaration.type === "TSInterfaceDeclaration") return declaration.body.body;
  if (declaration.typeAnnotation?.type === "TSTypeLiteral") return declaration.typeAnnotation.members;
  return [];
}

function propertyName(member) {
  return member.key?.name ?? staticString(member.key);
}

function propertyTypeNode(member) {
  return member.typeAnnotation?.typeAnnotation;
}

function arrayElementName(typeNode) {
  return arrayElementTypeName(typeNode) ?? (typeNode?.type === "TSArrayType" ? typeName(typeNode.elementType) : undefined);
}

function isAllowedOrderingArray(type) {
  return (type ?? "").split("|").map((part) => part.trim()).every((part) => primitiveOrIdTypePattern.test(part));
}

export const rule = createArchitectureRule({
  ruleId,
  summary: "Redux state stores collection objects directly in an array.",
  why: "Collection state should own entities through Collection<T, K> so IDs, maps, refs, and ordering remain consistent.",
  fix: "Store entities in Collection<T, K> and keep ordering arrays limited to primitive values or IDs.",
  create(_context, { report }) {
    return {
      ExportNamedDeclaration(node) {
        const declaration = node.declaration;
        if (!isStateShape(declaration)) return;

        for (const member of stateMembers(declaration)) {
          const memberType = propertyTypeNode(member);
          const elementType = arrayElementName(memberType);
          if (!elementType || isAllowedOrderingArray(elementType)) continue;

          report({
            node: memberType,
            summary: `Redux state field "${propertyName(member) ?? "unknown"}" in ${declaration.id.name} stores "${elementType}" objects in an array; use Collection<T, K> plus primitive/ID ordering arrays instead.`,
          });
        }
      },
      TSAsExpression(node) {
        const arrayExpression = unwrapExpression(node.expression);
        const elementType = arrayElementName(node.typeAnnotation);

        // Empty array assertions in initialState need explicit checking because there is no state member annotation to visit.
        if (arrayExpression?.type !== "ArrayExpression" || arrayExpression.elements.length > 0 || !elementType || isAllowedOrderingArray(elementType)) return;

        report({
          node: node.typeAnnotation,
          summary: `Redux state field "initialState" in initialState stores "${elementType}" objects in an array; use Collection<T, K> plus primitive/ID ordering arrays instead.`,
        });
      },
    };
  },
});

export const plugin = {
  meta: { name: `themis/architecture/collection-state-shape`, version: "0.1.0" },
  rules: { [ruleId]: rule },
};
export default plugin;
