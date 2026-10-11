import { useNavigate } from "react-router-dom";
import { paths } from "../../../lib/paths";
import { DomainControllerList } from "./DomainControllerList";
import { NoDomainControllers } from "./NoDomainControllers";

/** The page of the domain controllers: the list, and a click on one opens it. */
export const DomainControllers = () => {
    const navigate = useNavigate();
    return (
        <DomainControllerList onSelect={(dc) => navigate(paths.domainController(dc.id))} emptyMessage={<NoDomainControllers />} />
    );
};
