import { useState, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  content?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
  onChange?: (id: string) => void;
  className?: string;
}

export function Tabs({ items, defaultTab, onChange, className }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? items[0]?.id);

  const handleClick = (id: string) => {
    setActive(id);
    onChange?.(id);
  };

  const classes = ["atelier-tabs", className ?? ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <div className="atelier-tabs-bar" role="tablist">
        {items.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={active === item.id}
            className={active === item.id ? "atelier-tab active" : "atelier-tab"}
            onClick={() => handleClick(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="atelier-tabs-content">
        {items.find((i) => i.id === active)?.content}
      </div>
    </div>
  );
}
