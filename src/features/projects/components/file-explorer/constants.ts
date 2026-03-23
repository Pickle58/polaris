// Base padding for the root level of the file explorer
export const BASE_PADDING = 12;
// Additional padding per level of nesting
export const LEVEL_PADDING = 12;

export const getItemPadding = (level: number, isFile: boolean) => {
    // Files have a slight additional offset to align with the file icon
    const fileOffset = isFile ? 16 : 0;
    return BASE_PADDING + level * LEVEL_PADDING + fileOffset;
}