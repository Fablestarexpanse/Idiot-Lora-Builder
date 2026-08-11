import { useState } from "react";
import { Tags, Sparkles } from "lucide-react";
import { TagEditor } from "./TagEditor";
import { AiPanel } from "../ai/AiPanel";

type Tab = "tags" | "ai";

export function RightPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("tags");

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("tags")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors ${
            activeTab === "tags"
              ? "border-b-2 border-blue-500 text-blue-400"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          <Tags className="h-4 w-4" />
          Tags
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ai")}
          className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors ${
            activeTab === "ai"
              ? "border-b-2 border-purple-500 text-purple-400"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          AI
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {activeTab === "tags" ? <TagEditor /> : <AiPanel />}
      </div>
    </div>
  );
}
