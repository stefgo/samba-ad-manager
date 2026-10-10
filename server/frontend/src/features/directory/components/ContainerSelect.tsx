import { useMemo } from "react";
import { Select } from "@stefgo/react-ui-components";
import { useDirectoryTree } from "../../../queries/directory";
import { orderUnits, unitOptionLabel } from "../lib/unitTree";

interface ContainerSelectProps {
    label: string;
    value: string;
    onChange: (dn: string) => void;
    error?: string;
    hint?: string;
    /** Containers that cannot be chosen: an organizational unit cannot be moved into itself or below. */
    exclude?: (dn: string) => boolean;
}

/** A container of the directory, picked from the tree written out as an indented list. */
export const ContainerSelect = ({ label, value, onChange, error, hint, exclude }: ContainerSelectProps) => {
    const { data, isPending, error: loadError } = useDirectoryTree();
    const units = useMemo(() => orderUnits(data?.containers ?? []), [data]);

    return (
        <Select
            label={label}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={isPending}
            error={error ?? (loadError ? "The containers could not be loaded." : undefined)}
            hint={hint}
            options={[
                { value: "", label: isPending ? "Loading…" : "Choose a container…", disabled: true },
                ...units.map((unit) => ({
                    value: unit.dn,
                    label: unitOptionLabel(unit),
                    disabled: exclude?.(unit.dn) ?? false,
                })),
            ]}
        />
    );
};
