import React from 'react';
import {
  Box,
  Button,
  Icon,
  Link,
  MenuItem,
} from '@chakra-ui/react';
import { FaSmileBeam } from 'react-icons/fa';

export const SUPPORT_URL = 'https://www.buymeacoffee.com/f5news';
export const SUPPORT_MESSAGE = 'Help keep F5 News independent and ad-free.';

const externalLinkProps = {
  href: SUPPORT_URL,
  target: '_blank',
  rel: 'noopener noreferrer',
};

export const SupportButton = ({ children = 'Support F5 News', ...props }) => (
  <Button
    as="a"
    size="sm"
    variant="outline"
    color="textPrimary"
    borderColor="textSubtle"
    _hover={{
      bg: 'whiteAlpha.100',
      borderColor: 'textMuted',
      textDecoration: 'none',
    }}
    textStyle="control"
    {...externalLinkProps}
    {...props}
  >
    <Icon as={FaSmileBeam} mr={2} />
    {children}
  </Button>
);

export const SupportMenuItem = () => (
  <MenuItem as="a" textStyle="control" {...externalLinkProps}>
    <Box as={FaSmileBeam} ml={0} mr={2} />
    <span>Support F5 News</span>
  </MenuItem>
);

export const SupportMessage = props => (
  <Link
    color="footerLink"
    textStyle="utility"
    _hover={{
      color: 'footerLink',
      textDecoration: 'underline',
    }}
    {...externalLinkProps}
    {...props}
  >
    {SUPPORT_MESSAGE}
  </Link>
);
