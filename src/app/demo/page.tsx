"use client"

import { Button } from "@/components/ui/button"
import { useState } from "react";

export default function DemoPage() {
    const [loading, setLoading] = useState(false);
    const [loading2, setLoading2] = useState(false);


    const handleBlocking = async () => {
        setLoading(true);
        await fetch("/api/demo/blocking", {
            method: "POST",
        });
        setLoading(false);
    }

    const handleBackground = async () => {
        setLoading2(true);
        await fetch("/api/demo/background", {
            method: "POST",
        });
        setLoading2(false);
    }
    return (
        <div className="p=8 space-x-4">
            <Button disabled={loading} onClick={handleBlocking}>
                {loading ? "Loading..." : "Run Blocking API Route"}
                Blocking
            </Button>
            <Button disabled={loading} onClick={handleBackground}>
                {loading ? "Loading..." : "Run Background API Route"}
                Background
            </Button>
        </div>
    );
};