import { nanoid } from "nanoid";
import type {
  AccessibilityTree,
  AXNode,
  TextSnapshot,
  TextSnapshotNode,
} from "./types";

/**
 * Check if a node is a control element (from Puppeteer source)
 */
function isControl(axNode: AXNode): boolean {
  const role = axNode.role?.value || "";

  switch (role) {
    case "button":
    case "checkbox":
    case "ColorWell":
    case "combobox":
    case "DisclosureTriangle":
    case "listbox":
    case "menu":
    case "menubar":
    case "menuitem":
    case "menuitemcheckbox":
    case "menuitemradio":
    case "radio":
    case "scrollbar":
    case "searchbox":
    case "slider":
    case "spinbutton":
    case "switch":
    case "tab":
    case "textbox":
    case "tree":
    case "TreeItem":
      return true;
    default:
      return false;
  }
}

/**
 * Check if a node is a leaf node (from Puppeteer source)
 * Special case: control elements are treated as leaf nodes even if they have children
 */
function isLeafNode(axNode: AXNode): boolean {
  if (!axNode.childIds || axNode.childIds.length === 0) {
    return true;
  }

  // Control elements are treated as leaf nodes even if they have children
  return isControl(axNode);
}

/**
 * Check if a node has any interesting descendants in the given set
 */
function hasInterestingDescendantsInSet(
  axNode: AXNode,
  interestingNodes: Set<string>,
  nodeMap: Map<string, AXNode>,
): boolean {
  if (!axNode.childIds) {
    return false;
  }

  for (const childId of axNode.childIds) {
    if (interestingNodes.has(childId)) {
      return true;
    }

    const childNode = nodeMap.get(childId);
    if (
      childNode &&
      hasInterestingDescendantsInSet(childNode, interestingNodes, nodeMap)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a node is "interesting" - optimized for DevTools MCP-like output
 * More selective than Puppeteer to reduce noise
 */
function isInterestingNode(axNode: AXNode, insideControl = false): boolean {
  const role = axNode.role?.value || "";
  const name = axNode.name?.value || "";
  const value =
    typeof axNode.value?.value === "string" ? axNode.value.value : "";
  const description =
    typeof axNode.description?.value === "string"
      ? axNode.description.value
      : "";

  // Rule 1: If inside a control, only leaf nodes are interesting
  if (insideControl && isLeafNode(axNode)) {
    return true;
  }

  // Rule 2: Always include root
  if (role === "RootWebArea") {
    return true;
  }

  // Rule 2.5: Always include iframe nodes to preserve boundaries
  if (role === "Iframe" || role === "WebArea") {
    return true;
  }

  // Rule 3: Interactive elements are always interesting
  const interactiveRoles = [
    "button",
    "link",
    "textbox",
    "combobox",
    "checkbox",
    "radio",
    "menuitem",
    "tab",
    "slider",
    "spinbutton",
    "searchbox",
  ];

  if (interactiveRoles.includes(role)) {
    return true;
  }

  // Rule 4: Images are interesting
  if (role === "image" || role === "img") {
    return true;
  }

  // Rule 5: Text content with meaningful names
  if (role === "StaticText" && name && name.trim().length >= 2) {
    return true;
  }

  // Rule 6: Skip common layout containers
  const layoutRoles = [
    "generic",
    "none",
    "group",
    "main",
    "navigation",
    "contentinfo",
    "search",
    "banner",
    "complementary",
    "region",
    "article",
    "section",
  ];

  if (layoutRoles.includes(role)) {
    // Only include if they have meaningful content
    const hasContent = [name, value, description].some(
      (content) => content && content.trim().length > 1,
    );
    return hasContent;
  }

  // Rule 7: For other roles, be selective
  if (role && role !== "generic") {
    // Only include if they have meaningful content
    const hasContent = [name, value, description].some(
      (content) => content && content.trim().length > 1,
    );
    return hasContent;
  }

  return false;
}

function collectInterestingNodes(params: {
  axNode: AXNode;
  insideControl: boolean;
  interestingNodes: Set<string>;
  nodeMap: Map<string, AXNode>;
}): void {
  const { axNode, insideControl, interestingNodes, nodeMap } = params;
  // Add to collection if interesting
  if (isInterestingNode(axNode, insideControl)) {
    interestingNodes.add(axNode.nodeId);
  }

  // Update insideControl flag
  const childInsideControl = insideControl || isControl(axNode);

  // Recurse to children
  if (axNode.childIds) {
    for (const childId of axNode.childIds) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        collectInterestingNodes({
          axNode: childNode,
          insideControl: childInsideControl,
          interestingNodes,
          nodeMap,
        });
      }
    }
  }
}

function serializeTree(params: {
  axNode: AXNode;
  interestingNodes: Set<string>;
  nodeMap: Map<string, AXNode>;
  idToNode: Map<string, TextSnapshotNode>;
  existingNodeData: Map<number, { existingId: string; tagName: string }>;
}): TextSnapshotNode | null {
  const { axNode, interestingNodes, nodeMap, idToNode, existingNodeData } =
    params;
  const isInteresting = interestingNodes.has(axNode.nodeId);

  // Process children first (always recurse to find interesting descendants)
  const serializedChildren: TextSnapshotNode[] = [];
  if (axNode.childIds) {
    for (const childId of axNode.childIds) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        const child = serializeTree({
          axNode: childNode,
          interestingNodes,
          nodeMap,
          idToNode,
          existingNodeData,
        });
        if (child) {
          serializedChildren.push(child);
        }
      }
    }
  }

  // If this node is not interesting, we need to handle it differently
  if (!isInteresting) {
    // If no children, return null (this node is not interesting and has no interesting descendants)
    if (serializedChildren.length === 0) {
      return null;
    }

    // If only one child, return it directly (flatten single-child chains)
    if (serializedChildren.length === 1) {
      return serializedChildren[0] ?? null;
    }

    // If multiple children, we need to create a container node to hold them
    // This is the key fix - we can't just return null when there are multiple interesting children
    const role = axNode.role?.value || axNode.chromeRole?.value || "generic";
    const name = axNode.name?.value || "";

    // Try to reuse existing ID and get tagName, otherwise generate new one
    const existingData = axNode.backendDOMNodeId
      ? existingNodeData.get(axNode.backendDOMNodeId)
      : undefined;
    const nodeId = existingData?.existingId || nanoid(8);
    const tagName = existingData?.tagName || "";

    const containerNode: TextSnapshotNode = {
      id: nodeId,
      role,
      name,
      children: serializedChildren,
      backendDOMNodeId: axNode.backendDOMNodeId,
      frameId: axNode.frameId,
      tagName,
    };

    // Store in ID map
    idToNode.set(containerNode.id, containerNode);

    return containerNode;
  }

  // This node IS interesting - create it
  const role = axNode.role?.value || axNode.chromeRole?.value || "";
  let name = axNode.name?.value || "";
  const value = axNode.value?.value;
  const description = axNode.description?.value;

  // Normalize link names for better matching
  if (role === "link" && name) {
    // For Google search results and similar complex link texts
    // Extract the main text part and keep URL separate
    const urlMatch = name.match(/(https?:\/\/[^\s]+)/);
    if (urlMatch) {
      const url = urlMatch[1];
      const mainText = name.replace(/(https?:\/\/[^\s]+).*$/, "").trim();

      // If main text is duplicated (like "Model Context Protocol Model Context Protocol")
      // try to deduplicate it
      const words = mainText.split(/\s+/);
      const halfLength = Math.floor(words.length / 2);
      const firstHalf = words.slice(0, halfLength).join(" ");
      const secondHalf = words.slice(halfLength).join(" ");

      if (firstHalf === secondHalf && firstHalf.length > 0) {
        // Deduplicated text + URL
        name = `${firstHalf} ${url}`;
        console.log(
          `🔧 [DEBUG] Normalized duplicated link name: "${axNode.name?.value}" → "${name}"`,
        );
      } else if (mainText.length > 0) {
        // Keep original format but log it
        console.log(`🔧 [DEBUG] Link name with URL: "${name}"`);
      }
    }
  }

  // Try to reuse existing ID and get tagName, otherwise generate new one
  const existingData = axNode.backendDOMNodeId
    ? existingNodeData.get(axNode.backendDOMNodeId)
    : undefined;
  const nodeId = existingData?.existingId || nanoid(8);
  const tagName = existingData?.tagName || "";

  const node: TextSnapshotNode = {
    id: nodeId,
    role,
    name,
    children: serializedChildren,
    backendDOMNodeId: axNode.backendDOMNodeId,
    frameId: axNode.frameId,
    tagName,
  };

  // Add optional properties
  if (value) node.value = value;
  if (description) node.description = description;

  // Extract rich accessibility properties from CDP
  if (axNode.properties) {
    for (const prop of axNode.properties) {
      const propName = prop.name;
      const propValue = prop.value?.value;

      switch (propName) {
        case "focused":
          if (propValue) node.focused = true;
          break;
        case "disabled":
          if (propValue) node.disabled = true;
          break;
        case "expanded":
          node.expanded = propValue;
          break;
        case "selected":
          if (propValue) node.selected = true;
          break;
        case "checked":
          node.checked = propValue;
          break;
        case "pressed":
          node.pressed = propValue;
          break;
        case "level":
          node.level = propValue;
          break;
        case "valuemin":
          node.valuemin = propValue;
          break;
        case "valuemax":
          node.valuemax = propValue;
          break;
        case "autocomplete":
          node.autocomplete = propValue;
          break;
        case "haspopup":
          node.haspopup = propValue;
          break;
        case "invalid":
          node.invalid = propValue;
          break;
        case "orientation":
          node.orientation = propValue;
          break;
        case "modal":
          if (propValue) node.modal = true;
          break;
      }
    }
  }

  // Store in ID map
  idToNode.set(node.id, node);

  return node;
}

/**
 * Convert CDP accessibility tree to Puppeteer-like SerializedAXNode tree
 * This uses Puppeteer's TWO-PASS approach: collect interesting nodes, then serialize
 */
export function convertAccessibilityTreeToSnapshot(
  snapshotResult: AccessibilityTree,
  existingNodeData: Map<number, { existingId: string; tagName: string }>,
): Omit<TextSnapshot, "tabId"> | null {
  const nodes = snapshotResult.nodes;
  if (!nodes || nodes.length === 0) {
    return null;
  }

  console.log("🔍 [DEBUG] Processing", nodes.length, "raw CDP nodes");

  // Debug: show role distribution
  const roleCounts = new Map<string, number>();
  for (const node of nodes) {
    const role = node.role?.value || "unknown";
    roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
  }
  console.log(
    "📊 [DEBUG] Role distribution:",
    Array.from(roleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([role, count]) => `${role}:${count}`)
      .join(", "),
  );

  // Build nodeId -> AXNode map
  const nodeMap = new Map<string, AXNode>();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  // Find root (no parentId)
  const rootNode = nodes.find((n: AXNode) => !n.parentId);
  if (!rootNode) {
    return null;
  }

  // PASS 1: Collect interesting nodes (Puppeteer's approach)
  const interestingNodes = new Set<string>(); // Store nodeIds

  console.log("🔍 [DEBUG] Pass 1: Collecting interesting nodes...");
  collectInterestingNodes({
    axNode: rootNode,
    insideControl: false,
    interestingNodes,
    nodeMap,
  });
  console.log(`✅ [DEBUG] Found ${interestingNodes.size} interesting nodes`);

  if (interestingNodes.size === 0) {
    console.warn("⚠️ [DEBUG] No interesting nodes found!");
    return null;
  }

  // Additional filtering: Remove nodes that are just layout containers
  // This is a post-processing step to further reduce noise
  const finalInterestingNodes = new Set<string>();
  for (const nodeId of interestingNodes) {
    const node = nodeMap.get(nodeId);
    if (node) {
      const role = node.role?.value || "";
      const name = node.name?.value || "";
      const value = node.value?.value || "";
      const description = node.description?.value || "";

      // Skip pure layout containers with no meaningful content
      if (role === "generic" && !name && !value && !description) {
        // Check if this node has any interesting descendants
        const hasInterestingDescendants = hasInterestingDescendantsInSet(
          node,
          interestingNodes,
          nodeMap,
        );
        if (!hasInterestingDescendants) {
          console.log(
            `  ✗ Filtered out pure layout container: ${role} "${name}"`,
          );
          continue;
        }
      }

      // Additional quality filter: Skip nodes with very short or meaningless content
      if (role === "generic" && name) {
        const trimmedName = name.trim();
        // Skip nodes with very short names (likely just layout)
        if (trimmedName.length < 2) {
          console.log(`  ✗ Filtered out short content: ${role} "${name}"`);
          continue;
        }

        // Skip nodes that are just common layout text
        const layoutTexts = [
          "div",
          "span",
          "section",
          "article",
          "header",
          "footer",
          "nav",
          "main",
          "aside",
        ];
        if (layoutTexts.includes(trimmedName.toLowerCase())) {
          console.log(`  ✗ Filtered out layout text: ${role} "${name}"`);
          continue;
        }
      }

      finalInterestingNodes.add(nodeId);
    }
  }

  console.log(
    `✅ [DEBUG] After filtering: ${finalInterestingNodes.size} truly interesting nodes`,
  );
  interestingNodes.clear();
  for (const id of finalInterestingNodes) {
    interestingNodes.add(id);
  }

  // PASS 2: Serialize tree, only including interesting nodes
  const idToNode = new Map<string, TextSnapshotNode>();

  console.log("🔍 [DEBUG] Pass 2: Serializing tree...");
  const root = serializeTree({
    axNode: rootNode,
    interestingNodes,
    nodeMap,
    idToNode,
    existingNodeData,
  });
  if (!root) {
    console.warn("⚠️ [DEBUG] Failed to serialize root node");
    return null;
  }

  console.log(
    `✅ [DEBUG] Built accessibility tree with ${idToNode.size} interesting nodes`,
  );
  return {
    root,
    idToNode,
  };
}
