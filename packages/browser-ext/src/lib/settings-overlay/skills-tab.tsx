import type { FileTreeNode } from "@eterna/browser-runtime";
import { zenfs } from "@eterna/browser-runtime";
import { cn } from "@eterna/react/lib/utils";
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  UploadIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SkillMetadata } from "../../components/skill/types";
import { skillClientAdapter } from "../skill-client-adapter";
import { formatKb, MiniToggle, SearchBox } from "./shared";

// ---------------------------------------------------------------------------
// Skills tab — installed list + files tree
// ---------------------------------------------------------------------------

export function SkillsTab() {
  const [subTab, setSubTab] = useState<"installed" | "files">("installed");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-3.5 px-3.5 pt-2">
        {(["installed", "files"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            className={cn(
              "border-b-2 px-0.5 py-1.5 text-[12px] capitalize transition-colors",
              subTab === tab
                ? "border-foreground font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      {subTab === "installed" ? <SkillsInstalled /> : <SkillsFiles />}
    </div>
  );
}

function SkillsInstalled() {
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    await skillClientAdapter.initialize();
    setSkills([...skillClientAdapter.listSkills()]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpload = async (file: File) => {
    setUploadError(null);
    let result = await skillClientAdapter.uploadSkill(file);
    if (!result.ok && result.type === "conflict") {
      if (confirm(`Skill "${result.skillName}" already exists. Replace it?`)) {
        result = await skillClientAdapter.uploadSkill(file, true);
      } else {
        return;
      }
    }
    if (!result.ok) {
      setUploadError(
        result.type === "error" ? result.message : "Upload failed",
      );
      return;
    }
    await refresh();
  };

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleUpload(file);
    event.target.value = "";
  };

  const handleToggle = async (skill: SkillMetadata) => {
    if (skill.enabled) await skillClientAdapter.disableSkill(skill.id);
    else await skillClientAdapter.enableSkill(skill.id);
    await refresh();
  };

  const handleDelete = async (skill: SkillMetadata) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    await skillClientAdapter.deleteSkill(skill.id);
    setExpanded(null);
    await refresh();
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? skills.filter((s) => s.name.toLowerCase().includes(q))
    : skills;
  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-4">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) void handleUpload(file);
        }}
        className="flex w-full items-center gap-2.5 rounded-[11px] border border-border border-dashed p-3 text-left transition-colors hover:border-muted-foreground/50"
      >
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-muted/50 text-muted-foreground">
          <UploadIcon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-foreground">
            Drop a skill ZIP, or{" "}
            <span className="underline underline-offset-2">browse</span>
          </span>
          <span className="mt-[1px] block text-[10.5px] text-muted-foreground/80">
            ZIP with SKILL.md · max 10 MB
          </span>
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        onChange={onFilePicked}
        className="hidden"
      />

      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search skills…"
      />

      {uploadError && (
        <div className="rounded-[9px] border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-400">
          {uploadError}
        </div>
      )}

      <div className="px-0.5 text-[11px] text-muted-foreground">
        {skills.length} installed · {enabledCount} enabled
      </div>

      <div className="flex flex-col gap-[5px]">
        {visible.map((skill) => (
          <div
            key={skill.id}
            className="rounded-[11px] border border-border bg-muted/20 transition-colors hover:border-muted-foreground/30"
          >
            <div className="flex items-center gap-2.5 px-3 py-[11px]">
              <button
                type="button"
                onClick={() =>
                  setExpanded(expanded === skill.id ? null : skill.id)
                }
                className="min-w-0 flex-1 text-left"
              >
                <span className="mb-[2px] block truncate font-medium font-mono text-[13px] text-foreground">
                  {skill.name}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  v{skill.version}
                  {skill.uploadedAt
                    ? ` · uploaded ${new Date(skill.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                    : ""}
                </span>
              </button>
              <MiniToggle
                checked={skill.enabled}
                onChange={() => void handleToggle(skill)}
                label={`Enable ${skill.name}`}
              />
            </div>
            {expanded === skill.id && (
              <div className="flex flex-col gap-2 border-border/60 border-t px-3 py-2.5">
                {skill.description && (
                  <div className="text-[11px] text-muted-foreground leading-[1.5]">
                    {skill.description}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete(skill)}
                  className="self-start text-[11px] text-muted-foreground hover:text-red-400"
                >
                  Delete skill
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-0.5 pt-0.5 text-[10.5px] text-muted-foreground/80 leading-[1.5]">
        Tap a skill for details and delete.
      </div>
    </div>
  );
}

function countFiles(node: FileTreeNode): number {
  if (node.type === "file") return 1;
  return (node.children ?? []).reduce(
    (sum, child) => sum + countFiles(child),
    0,
  );
}

function FilesRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isDir = node.type === "directory";
  const isOpen = expanded.has(node.path);
  return (
    <>
      <button
        type="button"
        onClick={() => isDir && onToggle(node.path)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg py-[6px] pr-1.5 text-left transition-colors hover:bg-accent",
          depth === 0 ? "pl-1.5" : "",
        )}
        style={depth > 0 ? { paddingLeft: 6 + depth * 24 } : undefined}
      >
        {isDir ? (
          <ChevronRightIcon
            className={cn(
              "size-[11px] shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
          />
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        {isDir ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileIcon className="size-[13px] shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-[12.5px]",
            isDir ? "text-foreground" : "text-foreground/80",
          )}
        >
          {node.name}
        </span>
        {isDir && (
          <span className="shrink-0 text-[10.5px] text-muted-foreground/80">
            {countFiles(node)} files
          </span>
        )}
        <span className="w-[58px] shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
          {formatKb(node.size)}
        </span>
      </button>
      {isDir &&
        isOpen &&
        (node.children ?? []).map((child) => (
          <FilesRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

function SkillsFiles() {
  const [roots, setRoots] = useState<FileTreeNode[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        await zenfs.initialize();
        const [fileTree, usage] = await Promise.all([
          zenfs.getFileTree("/skills"),
          zenfs.getDiskUsage("/skills"),
        ]);
        setRoots(fileTree);
        setUsedBytes(
          typeof usage === "number"
            ? usage
            : ((usage as { totalSize?: number })?.totalSize ?? 0),
        );
      } catch {
        setRoots([]);
      }
    })();
  }, []);

  const totalFiles = roots.reduce((sum, node) => sum + countFiles(node), 0);
  const totalFolders = roots.filter((n) => n.type === "directory").length;

  const q = query.trim().toLowerCase();
  const flatMatches = useMemo(() => {
    if (!q) return [];
    const out: FileTreeNode[] = [];
    const walk = (node: FileTreeNode) => {
      if (node.type === "file" && node.name.toLowerCase().includes(q)) {
        out.push(node);
      }
      for (const child of node.children ?? []) walk(child);
    };
    for (const root of roots) walk(root);
    return out;
  }, [q, roots]);

  const onToggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-4">
      <div className="flex items-center justify-between rounded-[11px] border border-border bg-muted/20 px-3 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          {totalFiles} files · {totalFolders} folders
        </span>
        <span className="font-mono text-[11.5px] text-foreground/80">
          {formatKb(usedBytes)} used
        </span>
      </div>

      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search files and folders…"
      />

      <div className="flex flex-col">
        {q
          ? flatMatches.map((node) => (
              <div
                key={node.path}
                className="flex items-center gap-2 rounded-lg px-1.5 py-[6px]"
              >
                <FileIcon className="size-[13px] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12.5px] text-foreground/90">
                    {node.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground/70">
                    {node.path}
                  </span>
                </span>
                <span className="w-[58px] shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
                  {formatKb(node.size)}
                </span>
              </div>
            ))
          : roots.map((node) => (
              <FilesRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))}
        {q && flatMatches.length === 0 && (
          <div className="px-1.5 py-4 text-center text-[11.5px] text-muted-foreground">
            No matching files
          </div>
        )}
      </div>
    </div>
  );
}
