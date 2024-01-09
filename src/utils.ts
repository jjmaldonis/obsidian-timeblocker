import { findIconDefinition, icon } from "@fortawesome/fontawesome-svg-core";
import type { IconDefinition, IconName } from "@fortawesome/fontawesome-svg-core";
import type { IconPrefix } from "@fortawesome/free-regular-svg-icons";

export function getFAIcon(definition: IconDefinition) {
    return icon(definition);
}

export function getIcon(iconName: string) {
    for (const prefix of ["fas", "far", "fab", "fa"] as IconPrefix[]) {
        const definition = findIconDefinition({
            iconName: iconName as IconName,
            prefix
        });
        console.log(definition, iconName);
        if (definition) return getFAIcon(definition).node[0];
    }
}