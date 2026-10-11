import { Check, Copy } from "lucide-react";
import { ActionButton, cn, useCopyToClipboard } from "@stefgo/react-ui-components";

interface CopyButtonProps {
    /** What is put on the clipboard. */
    text: string;
}

/**
 * The copy button a `DescriptionList` puts behind a value (`copyable`), for a value that
 * stands somewhere else: a table cell. Where the clipboard is not available it does
 * nothing; the value is on screen and can be selected.
 */
export const CopyButton = ({ text }: CopyButtonProps) => {
    const { copied, copy } = useCopyToClipboard();

    return (
        <ActionButton
            icon={copied ? Check : Copy}
            size="sm"
            color="green"
            tooltip={copied ? "Copied" : "Copy to clipboard"}
            className={cn("shrink-0", copied && "text-success")}
            onClick={() => void copy(text)}
        />
    );
};
