import { useState } from "react";
import { useNavigate, type To } from "react-router-dom";
import { FolderInput, PencilLine, Trash2 } from "lucide-react";
import { MenuItem, useConfirm, useToast } from "@stefgo/react-ui-components";
import { directoryApi, useDirectoryChange } from "../../../queries/directory";
import { describeDeleteObject } from "../confirmations";
import { MoveDialog, RenameDialog } from "./ObjectDialogs";

/** What of an object the three actions need. */
export interface ActionObject {
    guid: string;
    dn: string;
    parentDn: string;
    cn: string;
    /** What a reader calls it. */
    name: string;
    type: string;
    protected: boolean;
}

/**
 * Rename, move and delete: what can be done to an object of any kind. Returns the menu
 * entries and the dialogs they open, for the page to place -- the entries inside its menu,
 * the dialogs anywhere.
 *
 * A protected object keeps the entries, disabled: that they exist and are not offered is
 * the information.
 */
export function useObjectActions(object: ActionObject, options: { afterDelete: To; closeMenu: () => void }) {
    const navigate = useNavigate();
    const { confirm } = useConfirm();
    const { show } = useToast();
    const [dialog, setDialog] = useState<"move" | "rename" | null>(null);
    const move = useDirectoryChange((parentDn: string) => directoryApi.moveObject(object.guid, parentDn));
    const rename = useDirectoryChange((name: string) => directoryApi.renameObject(object.guid, name));
    const remove = useDirectoryChange(() => directoryApi.deleteObject(object.guid));

    const open = (which: "move" | "rename") => {
        options.closeMenu();
        setDialog(which);
    };

    const requestDelete = () => {
        options.closeMenu();
        // A refused delete keeps the dialog open, with the directory's reason in it.
        confirm({
            ...describeDeleteObject(object),
            onConfirm: async () => {
                await remove.mutateAsync(undefined);
                show({ variant: "success", title: `${object.name} was deleted` });
                navigate(options.afterDelete);
            },
        });
    };

    const reason = object.protected ? "The directory needs this object." : undefined;

    const menuItems = (
        <>
            <MenuItem icon={PencilLine} disabled={object.protected} disabledTitle={reason} onClick={() => open("rename")}>
                Rename
            </MenuItem>
            <MenuItem icon={FolderInput} disabled={object.protected} disabledTitle={reason} onClick={() => open("move")}>
                Move
            </MenuItem>
            <MenuItem icon={Trash2} variant="danger" disabled={object.protected} disabledTitle={reason} onClick={requestDelete}>
                Delete
            </MenuItem>
        </>
    );

    const dialogs = (
        <>
            {dialog === "move" && (
                <MoveDialog
                    object={object}
                    onClose={() => setDialog(null)}
                    onMove={async (parentDn) => {
                        await move.mutateAsync(parentDn);
                        show({ variant: "success", title: `${object.name} was moved` });
                    }}
                />
            )}
            {dialog === "rename" && (
                <RenameDialog
                    object={object}
                    onClose={() => setDialog(null)}
                    onRename={async (name) => {
                        await rename.mutateAsync(name);
                        show({ variant: "success", title: `${object.name} was renamed` });
                    }}
                />
            )}
        </>
    );

    return { menuItems, dialogs };
}
