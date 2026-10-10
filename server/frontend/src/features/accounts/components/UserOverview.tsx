import { useState } from "react";
import { UserDialog } from "./UserDialog";
import { UserList, UserData } from "./UserList";
import { useConfirm } from "@stefgo/react-ui-components";
import { describeDeleteUser, describeLastUser } from "../confirmations";
import { QueryError } from "../../../components/QueryError";
import { useDeleteUser, useSaveUser, useUsers } from "../../../queries/users";

const NO_USERS: UserData[] = [];

export const UserOverview = () => {
    const { data, isPending, error } = useUsers();
    const users = data ?? NO_USERS;
    const saveUser = useSaveUser();
    const deleteUser = useDeleteUser();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<UserData | null>(null);
    const { confirm, alert } = useConfirm();

    const handleCreateUser = () => {
        setEditingUser(null);
        setIsDialogOpen(true);
    };

    const handleEditUser = (user: UserData) => {
        setEditingUser(user);
        setIsDialogOpen(true);
    };

    /**
     * The list already disables the entry for the last user, so this branch is the second
     * net -- it catches a list that has gone stale, which is exactly when the click gets
     * through. The server refuses the same case in UserController.delete; asking here
     * means the operator reads why instead of an error after the fact.
     */
    const requestDeleteUser = (user: UserData) => {
        // A notice rather than a mode of the delete dialog: the two say different things,
        // and this one must not be able to reach the request at all.
        if (users.length <= 1) {
            alert(describeLastUser(user.username));
            return;
        }
        // A refused delete keeps the dialog open, with the server's reason in it.
        confirm({
            ...describeDeleteUser(user.username),
            onConfirm: () => deleteUser.mutateAsync(user.id),
        });
    };

    // A refusal is thrown to the dialog, which shows the server's reason next to the form.
    const handleSaveUser = (data: { username: string; password?: string; auth_methods?: string }) =>
        saveUser.mutateAsync({ id: editingUser?.id, data });

    // Instead of the list: an empty one would say there are no users.
    if (error && data === undefined) return <QueryError title="Could not load the accounts" error={error} />;

    return (
        <div className="space-y-6">
            <UserList
                users={users}
                isLoading={isPending}
                onCreateUser={handleCreateUser}
                onEditUser={handleEditUser}
                onDeleteUser={requestDeleteUser}
            />

            <UserDialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSave={handleSaveUser}
                editingUser={editingUser}
            />
        </div>
    );
};
