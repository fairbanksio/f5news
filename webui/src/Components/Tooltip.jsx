import { Portal, Tooltip as ChakraTooltip } from '@chakra-ui/react';

export function Tooltip({ children, label, placement, ...props }) {
  return (
    <ChakraTooltip.Root openDelay={0} closeDelay={0} positioning={{ placement }} {...props}>
      <ChakraTooltip.Trigger asChild>{children}</ChakraTooltip.Trigger>
      <Portal>
        <ChakraTooltip.Positioner>
          <ChakraTooltip.Content>{label}</ChakraTooltip.Content>
        </ChakraTooltip.Positioner>
      </Portal>
    </ChakraTooltip.Root>
  );
}

export default Tooltip;
