/**
 * StatCard – visning av nøkkeltall (f.eks. på oversikt).
 * Tar imot ikon, label, verdi og farge som props.
 */


import type { ComponentType } from "react";

interface StatCardProps {
    icon: ComponentType<{ size?: number; className?: string }>;
    label: string;
    value: number | string;
    color: "blue" | "green" | "yellow" | "purple" | "slate";
}

const colorClasses = {
    blue: "bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
    green: "bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400",
    yellow: "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400",
    purple: "bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
    slate: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
};

export function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
    return (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{label}</p>
                    <p className="text-3xl font-bold text-slate-900 dark:text-white mt-1">
                        {value}
                    </p>
                </div>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorClasses[color]}`}>
                    <Icon size={24} />
                </div>
            </div>
        </div>
    );
}
