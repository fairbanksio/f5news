import React from 'react';
import {
  Box,
  Button,
  Icon,
  Link,
} from '@chakra-ui/react';
import { FaSmileBeam } from 'react-icons/fa';
import { trackSupportClick } from '../analytics';
import { useColorModeValue } from '../Contexts/ColorModeContext';

export const SUPPORT_URL = 'https://www.buymeacoffee.com/f5news';
export const SUPPORT_MESSAGE = 'Help keep F5 News independent and ad-free.';

const externalLinkProps = {
  href: SUPPORT_URL,
  target: '_blank',
  rel: 'noopener noreferrer',
};

export const SupportButton = ({ children = 'Support F5 News', ...props }) => {
  const color = useColorModeValue('#333', '#A0AEC0');
  const borderColor = useColorModeValue('#718096', 'rgba(255, 255, 255, 0.16)');
  const hoverBg = useColorModeValue('gray.200', 'whiteAlpha.300');
  const hoverBorderColor = useColorModeValue('gray.300', 'whiteAlpha.400');

  return (
    <Button
      as="a"
      size="sm"
      variant="outline"
      h="32px"
      minH="32px"
      minW="32px"
      px={3}
      borderRadius="md"
      borderWidth="1px"
      style={{
        backgroundColor: 'transparent',
        borderColor,
        borderRadius: '6px',
        color,
        height: '32px',
        minHeight: '32px',
        padding: '0 12px',
      }}
      _hover={{
        bg: hoverBg,
        borderColor: hoverBorderColor,
        textDecoration: 'none',
      }}
      textStyle="control"
      onClick={() => trackSupportClick({ surface: 'desktop' })}
      {...externalLinkProps}
      {...props}
    >
      <Icon as={FaSmileBeam} mr={2} />
      {children}
    </Button>
  );
};

export const SupportMenuItem = ({ onSelect } = {}) => (
  <Link
    role="menuitem"
    display="flex"
    alignItems="center"
    w="100%"
    px={3}
    py={2}
    color="textPrimary"
    textDecoration="none"
    style={{
      height: '27px',
      minHeight: '27px',
      paddingBottom: 0,
      paddingTop: 0,
    }}
    _hover={{
      bg: { _light: 'gray.100', _dark: 'whiteAlpha.200' },
      textDecoration: 'none',
    }}
    textStyle="control"
    onClick={() => {
      trackSupportClick({ surface: 'mobile' });
      onSelect?.();
    }}
    {...externalLinkProps}
  >
    <Box as={FaSmileBeam} ml={0} mr={2} />
    <span>Support F5 News</span>
  </Link>
);

export const SupportMessage = props => (
  <Link
    color="footerLink"
    textStyle="utility"
    _hover={{
      color: 'footerLink',
      textDecoration: 'underline',
    }}
    onClick={() => trackSupportClick({ surface: 'footer' })}
    {...externalLinkProps}
    {...props}
  >
    {SUPPORT_MESSAGE}
  </Link>
);
