# Copyright (c) 2015, Ignacio Calderon
# All rights reserved.
#
# Redistribution and use in source and binary forms, with or without
# modification, are permitted provided that the following conditions are met:
#
# * Redistributions of source code must retain the above copyright notice, this
#   list of conditions and the following disclaimer.
#
# * Redistributions in binary form must reproduce the above copyright notice,
#   this list of conditions and the following disclaimer in the documentation
#   and/or other materials provided with the distribution.
#
# THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
# AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
# IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
# DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
# FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
# DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
# SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
# CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
# OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
# OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


import sys


_WHITESPACE = frozenset(' \t\n\r')
_UNQUOTED_LITERAL_ENDER = frozenset(';,})').union(_WHITESPACE)
_KEY_ENDER = frozenset(';=').union(_WHITESPACE)
_LITERAL_ESCAPES = {'\\"': '"', "\\'": "'", "\\0": "\0", "\\\\": "\\", "\\n": "\n", "\\t": "\t"}


class OpenStepDecoder(object):
    @classmethod
    def ParseFromFile(cls, fp):
        # Check the python version to support unicode files in python 2
        if sys.version_info > (3, 0):
            return cls.ParseFromString(fp.read())
        else:
            return cls.ParseFromString(fp.read().decode('UTF-8'))

    @classmethod
    def ParseFromString(cls, str):
        return OpenStepDecoder()._parse(str)

    def _parse(self, str):
        # parse the comment if any
        index = 0
        if str[0] == '/' and str[1] == '/':
            while str[index] != '{':
                index += 1

        result, index = self._parse_dictionary(str, index)
        return result

    def _parse_dictionary(self, str, index):
        obj = {}

        if str[index] != '{':
            raise Exception("Expected { as dictionary start")

        index = self._parse_padding(str, index + 1)

        while str[index] != '}':
            index = self._parse_dictionary_entry(str, index, obj)
            index = self._parse_padding(str, index)

        index = self._parse_padding(str, index + 1)

        return obj, index

    def _parse_array(self, str, index):
        obj = []

        if str[index] != '(':
            raise Exception("Expected ( as dictionary start")

        index = self._parse_padding(str, index + 1)
        while str[index] != ')':
            index = self._parse_array_entry(str, index, obj)
            index = self._parse_padding(str, index)

        index = self._parse_padding(str, index + 1)

        return obj, index

    def _parse_dictionary_entry(self, str, index, dictionary):
        # adds a entry to the given dictionary
        key, index = self._parse_key(str, index)

        if str[index] != '=':
            raise Exception("Expected = after a key. Found {1} @ {0}".format(index, str[index]))

        index = self._parse_padding(str, index + 1)
        value, index = self._parse_value(str, index)

        dictionary[key] = value

        if str[index] == '}':
            # Let the caller know we're finished by NOT skipping the "}" from the stream.
            return index

        if str[index] != ';':
            raise Exception("Expected ; after a value. Found {1} @ {0}".format(index, str[index]))

        # Skip the ";" character.
        return index + 1

    def _parse_array_entry(self, str, index, array):
        # parse a: dict, array or value until the ','
        value, index = self._parse_value(str, index)

        array.append(value)

        if str[index] == ')':
            # Let the caller know we're finished by NOT skipping the ")" from the stream.
            return index

        if str[index] != ',':
            raise Exception("Expected , after a value. Found {1} @ {0} = {2}".format(index, str[index], value))

        return index + 1

    def _parse_padding(self, str, index):
        str_len = len(str)

        # Ignore whitespace
        while index < str_len and str[index] in _WHITESPACE:
            index += 1

        # Ignore comment
        if index + 1 < str_len and str[index] == '/' and str[index + 1] == '*':
            # move after the first character in the comment
            index += 2

            while not (str[index] == '*' and str[index + 1] == '/'):
                index += 1

            # move after the first character after the comment
            index += 2

        # Ignore whitespace
        while index < str_len and str[index] in _WHITESPACE:
            index += 1

        return index

    def _parse_key(self, str, index):
        # returns the key and the last index.
        index = self._parse_padding(str, index)

        start_index = index
        if str[index] == '"':
            index += 1
            while str[index] != '"':
                index += 1
            start_index += 1
            end_index = index
            index += 1
        else:
            while str[index] not in _KEY_ENDER:
                index += 1
            end_index = index

        key = str[start_index:end_index]

        index = self._parse_padding(str, index)
        return key, index

    def _parse_literal(self, str, index):
        # returns the key and the last index.
        index = self._parse_padding(str, index)

        if str[index] == '"':
            index += 1
            # if the literal starts with " then spaces are allowed
            start_index = index
            while str[index] != '"' or str[index - 1] == "\\":
                index += 1
            key = str[start_index:index]
            for escaped_value, real_value in _LITERAL_ESCAPES.items():
                key = key.replace(escaped_value, real_value)
            index += 1
        else:
            # otherwise stop in the spaces.
            start_index = index
            while str[index] not in _UNQUOTED_LITERAL_ENDER:
                index += 1
            key = str[start_index:index]

        index = self._parse_padding(str, index)
        return key, index

    def _parse_value(self, str, index):
        # return an object depending on the value of the first character.

        if str[index] == '{':
            value, index = self._parse_dictionary(str, index)
        elif str[index] == '(':
            value, index = self._parse_array(str, index)
        else:
            value, index = self._parse_literal(str, index)

        return value, index
